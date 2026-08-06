import { FilterContextMenu, SelectorResult } from '@/types/filter'
import { logger } from '@/utils/logger'
import { orderedUniq } from '@/utils/tool'
import { GM_getValue, GM_setValue } from '$'

export const partitionTagClass = 'bili-cleaner-partition-tag'

// 分区ID → 分区名称对照表（来自热门/排行榜接口实测，view接口的tname常为空，用于补全名称）
export const partitionNameMap: Record<string, string> = {
    17: '单机游戏',
    21: '日常',
    22: '鬼畜调教',
    24: 'MAD·AMV',
    27: '综合',
    30: 'VOCALOID·UTAU',
    31: '翻唱',
    47: '同人·手书',
    59: '演奏',
    65: '网络游戏',
    76: '美食制作',
    85: '小剧场',
    86: '特摄',
    95: '数码',
    121: 'GMV',
    124: '社科·法律·心理',
    130: '音乐综合',
    136: '音游',
    137: '明星综合',
    138: '搞笑',
    161: '手工',
    162: '绘画',
    164: '健身',
    171: '电子竞技',
    172: '手机游戏',
    173: '桌游棋牌',
    176: '汽车生活',
    182: '影视杂谈',
    183: '影视剪辑',
    193: 'MV',
    201: '科学科普',
    205: '社会',
    207: '财经商业',
    208: '校园学习',
    212: '美食侦探',
    215: '美食记录',
    216: '鬼畜剧场',
    218: '喵星人',
    219: '汪星人',
    220: '动物二创',
    228: '人文历史',
    232: '科工机械',
    238: '运动综合',
    240: '摩托车',
    241: '娱乐杂谈',
    242: '娱乐粉丝创作',
    243: '乐评盘点',
    250: '出行',
    251: '三农',
    252: '仿妆cos',
    253: '动漫杂谈',
    256: '短片',
    260: '影视整活',
}

// UP主昵称元素选择器，分区标签插在其上方
const upnameSelectors = [
    '.info > .upname', // 播放页相关视频
    '.bili-video-card__info--owner', // 搜索页
    '.up-name', // 热门页
]

/**
 * 解析分区数据 `${tid}|${tname}`，如 `124|社科·法律·心理`
 * @param value 分区数据，无数据或非字符串时返回 null
 */
export const parsePartitionValue = (value: SelectorResult): { tid?: string; tname: string } | null => {
    if (typeof value !== 'string') {
        return null
    }
    const sepIdx = value.indexOf('|')
    const tid = sepIdx >= 0 ? value.slice(0, sepIdx).trim() : ''
    const tname = sepIdx >= 0 ? value.slice(sepIdx + 1).trim() : value.trim()
    if (!tname) {
        return null
    }
    return tid ? { tid, tname } : { tname }
}

/**
 * 在视频卡片上显示/更新/移除分区标签
 * placement: 'before-upname' 插在UP主昵称上方；'after-date' 跟在昵称行（上传时间）后面
 * @param card 视频卡片元素
 * @param value 分区数据，无数据或非字符串时移除已有标签
 * @param placement 标签插入位置，默认插在UP主昵称上方
 */
export const setPartitionTag = (
    card: HTMLElement,
    value: SelectorResult,
    placement: 'before-upname' | 'after-date' = 'before-upname',
): void => {
    const tag = card.querySelector<HTMLElement>(`.${partitionTagClass}`)
    if (typeof value !== 'string') {
        tag?.remove()
        return
    }
    const partition = parsePartitionValue(value)
    if (!partition) {
        tag?.remove()
        return
    }
    const tname = partition.tname || (partition.tid && partitionNameMap[partition.tid]) || ''
    const text = partition.tid ? `${partition.tid} ${tname}`.trim() : tname
    if (!text) {
        tag?.remove()
        return
    }
    if (tag) {
        // 已存在则只更新文本，避免触发 MutationObserver 死循环
        if (tag.textContent !== text) {
            tag.textContent = text
        }
        return
    }
    const el = document.createElement('span')
    el.className = partitionTagClass
    el.textContent = text
    el.title = partition.tid ? `分区ID ${partition.tid} · ${tname}` : tname
    if (placement === 'after-date') {
        // 首页：跟在昵称行的上传时间后面，形成 昵称 上传时间 分区 左右排列
        const date = card.querySelector<HTMLElement>('span.bili-video-card__info--date')
        date?.parentElement?.insertBefore(el, date.nextSibling)
        return
    }
    // 定位UP主昵称元素，在它上方插入分区标签
    let anchor: HTMLElement | null = null
    for (const selector of upnameSelectors) {
        anchor = card.querySelector<HTMLElement>(selector)
        if (anchor) {
            break
        }
    }
    if (!anchor) {
        return
    }
    anchor.parentElement?.insertBefore(el, anchor)
}

/**
 * 构建分区右键菜单：屏蔽分区（按分区ID精准屏蔽）
 * 仅在分区过滤启用且存在分区ID时返回菜单
 */
export const buildPartitionContextMenus = (opts: {
    partition: { tid?: string; tname: string }
    isEnable: boolean
    valueKey: string
    addParam: (value: string) => void
    checkFull: () => void
}): FilterContextMenu[] => {
    const menus: FilterContextMenu[] = []
    if (!opts.isEnable || !opts.partition.tid) {
        return menus
    }
    const tid = opts.partition.tid
    menus.push({
        name: `屏蔽分区：${opts.partition.tname}`,
        fn: async () => {
            try {
                opts.addParam(tid)
                opts.checkFull()
                const arr: string[] = GM_getValue(opts.valueKey, [])
                arr.unshift(tid)
                GM_setValue(opts.valueKey, orderedUniq(arr))
            } catch (err) {
                logger.error(`block partition ${opts.partition.tname} failed`, err)
            }
        },
    })
    return menus
}
