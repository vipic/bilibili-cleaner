import { unsafeWindow } from '$'
import { SelectorResult } from '@/types/filter'
import { logger } from '@/utils/logger'
import { partitionNameMap } from './partition'
import pLimit from 'p-limit'

// 并发限制
const limit = pLimit(4)

// bvid -> `${tid}|${tname}`；空字符串表示无分区/获取失败
// 失败缓存 60s 后允许重试，避免永久缺失
const RETRY_INTERVAL = 60_000
const partitionCache = new Map<string, { value: string; ts: number }>()
const pending = new Map<string, Promise<void>>()

/** 抓取单个bvid的分区数据，失败时返回空字符串 */
const fetchPartition = async (bvid: string): Promise<string> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
        const resp = await unsafeWindow.fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
            credentials: 'include',
            signal: controller.signal,
        })
        const data = await resp.json()
        const d = data?.data
        const tid = d?.tid ? String(d.tid) : ''
        const tname = (d?.tname as string | undefined)?.trim() || (tid && partitionNameMap[tid]) || ''
        return tid || tname ? `${tid}|${tname}` : ''
    } finally {
        clearTimeout(timer)
    }
}

/**
 * 按bvid抓取视频分区数据（首页rcmd数据不含分区，需要按bvid请求view接口）
 * 失败自动重试一次；已失败且未到重试间隔的bvid跳过
 * @param bvids 需要抓取的bvid列表
 */
export const ensurePartition = async (bvids: string[]): Promise<void> => {
    const now = Date.now()
    const tasks: Promise<void>[] = []
    const toDelete: string[] = []
    for (const bvid of bvids) {
        const cached = partitionCache.get(bvid)
        if (!bvid || pending.has(bvid)) {
            continue
        }
        // 成功过，或失败未到重试间隔，跳过
        if (cached && (cached.value !== '' || now - cached.ts < RETRY_INTERVAL)) {
            continue
        }
        const task = limit(async () => {
            let value = ''
            try {
                value = await fetchPartition(bvid)
                if (!value) {
                    // 失败重试一次
                    value = await fetchPartition(bvid)
                }
            } catch (err) {
                logger.error(`fetch partition by bvid ${bvid} failed`, err)
            }
            partitionCache.set(bvid, { value, ts: Date.now() })
        })
        pending.set(bvid, task)
        tasks.push(task)
        toDelete.push(bvid)
    }
    if (tasks.length) {
        await Promise.all(tasks)
    }
    toDelete.forEach((bvid) => pending.delete(bvid))
}

/**
 * 同步读取缓存中的分区数据，未加载时返回 undefined
 * @param bvid 视频bvid
 */
export const getPartition = (bvid?: string): SelectorResult => {
    if (!bvid) {
        return undefined
    }
    return partitionCache.get(bvid)?.value
}
