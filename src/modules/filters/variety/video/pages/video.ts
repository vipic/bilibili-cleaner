import { unsafeWindow } from '$'
import { coreCheck } from '@/modules/filters/core/core'
import config from '@/config'
import { Group } from '@/types/collection'
import { ContextMenuTargetHandler, FilterContextMenu, IMainFilter, SelectorResult, SubFilterPair } from '@/types/filter'
import { logger } from '@/utils/logger'
import { isPageBangumi, isPagePlaylist, isPageVideo } from '@/utils/pageType'
import { GM_getValue, GM_setValue } from '$'
import { promptKeyword } from '@/utils/keywordPrompt'
import { convertTimeToSec, isEleHide, matchBvid, orderedUniq, showEle, waitForEle } from '@/utils/tool'
import {
    VideoDurationFilter,
    VideoPartitionFilter,
    VideoTitleFilter,
    VideoUploaderFilter,
    VideoUploaderKeywordFilter,
} from '../subFilters/black'
import { VideoUploaderWhiteFilter } from '../subFilters/white'
import {
    buildPartitionContextMenus,
    parsePartitionValue,
    partitionLinesToValue,
    partitionValueToLines,
    setPartitionTag,
} from '../partition'

const GM_KEYS = {
    black: {
        duration: {
            statusKey: 'global-duration-filter-status',
            valueKey: 'global-duration-filter-value',
        },
        uploader: {
            statusKey: 'global-uploader-filter-status',
            valueKey: 'global-uploader-filter-value',
        },
        uploaderKeyword: {
            statusKey: 'global-uploader-keyword-filter-status',
            valueKey: 'global-uploader-keyword-filter-value',
        },
        title: {
            statusKey: 'global-title-keyword-filter-status',
            valueKey: 'global-title-keyword-filter-value',
        },
        related: {
            statusKey: 'video-related-filter-status',
        },
        partition: {
            statusKey: 'global-partition-filter-status',
            valueKey: 'global-partition-filter-value',
        },
        partitionTag: {
            statusKey: 'global-partition-tag-status',
        },
    },
    white: {
        uploader: {
            statusKey: 'global-uploader-whitelist-filter-status',
            valueKey: 'global-uploader-whitelist-filter-value',
        },
    },
}

// 相关视频 分区缓存数据 (bvid -> `${tid}|${tname}`)
let relatedPartitionMap = new Map<string, string>()
const getRelatedPartitionMap = (): Map<string, string> => {
    const map = new Map<string, string>()
    const related = unsafeWindow.__INITIAL_STATE__?.related
    if (Array.isArray(related)) {
        for (const v of related) {
            if (v?.bvid && (v.tid || v.tname)) {
                map.set(v.bvid, [v.tid, v.tname].join('|'))
            }
        }
    }
    return map
}

// 视频列表信息提取
const selectorFns = {
    duration: (video: HTMLElement): SelectorResult => {
        const duration = video.querySelector('.pic-box span.duration')?.textContent
        return duration ? convertTimeToSec(duration) : undefined
    },
    title: (video: HTMLElement): SelectorResult => {
        return video.querySelector('.info > a p')?.textContent?.trim()
    },
    bvid: (video: HTMLElement): SelectorResult => {
        const href =
            video.querySelector('.info > a')?.getAttribute('href') ||
            video.querySelector('.pic-box .framepreview-box > a')?.getAttribute('href')
        return (href && matchBvid(href)) ?? undefined
    },
    uploader: (video: HTMLElement): SelectorResult => {
        return video.querySelector('.info > .upname .name')?.textContent?.trim()
    },
    partition: (video: HTMLElement): SelectorResult => {
        const bvid = selectorFns.bvid(video)
        return (typeof bvid === 'string' && relatedPartitionMap.get(bvid)) ?? undefined
    },
}

// 是否检测相关视频缓存数据
let enableRelatedCheck = false

class VideoFilterVideo implements IMainFilter {
    target: HTMLElement | undefined

    // 黑名单
    videoDurationFilter = new VideoDurationFilter()
    videoTitleFilter = new VideoTitleFilter()
    videoUploaderFilter = new VideoUploaderFilter()
    videoUploaderKeywordFilter = new VideoUploaderKeywordFilter()
    videoPartitionFilter = new VideoPartitionFilter()
    // 显示分区标签
    showPartitionTag = false

    // 白名单
    videoUploaderWhiteFilter = new VideoUploaderWhiteFilter()

    init() {
        // 黑名单
        this.videoDurationFilter.setParam(GM_getValue(GM_KEYS.black.duration.valueKey, 0))
        this.videoTitleFilter.setParam(GM_getValue(GM_KEYS.black.title.valueKey, []))
        this.videoUploaderFilter.setParam(GM_getValue(GM_KEYS.black.uploader.valueKey, []))
        this.videoUploaderKeywordFilter.setParam(GM_getValue(GM_KEYS.black.uploaderKeyword.valueKey, []))
        this.videoPartitionFilter.setParam(GM_getValue(GM_KEYS.black.partition.valueKey, []))
        // 白名单
        this.videoUploaderWhiteFilter.setParam(GM_getValue(GM_KEYS.white.uploader.valueKey, []))
    }

    async check(mode?: 'full' | 'incr') {
        if (!this.target) {
            return
        }
        let revertAll = false
        if (!(
            this.videoDurationFilter.isEnable ||
            this.videoTitleFilter.isEnable ||
            this.videoUploaderFilter.isEnable ||
            this.videoUploaderKeywordFilter.isEnable ||
            this.videoPartitionFilter.isEnable
        )) {
            revertAll = true
        }
        const timer = performance.now()

        // 刷新相关视频分区缓存
        relatedPartitionMap = getRelatedPartitionMap()

        // 提取元素
        const selector = `.next-play :is(.video-page-card-small, .video-page-operator-card-small),
            .rec-list :is(.video-page-card-small, .video-page-operator-card-small), .recommend-video-card`
        const videos = Array.from(this.target.querySelectorAll<HTMLElement>(selector))
        if (!videos.length) {
            return
        }
        // 分区标签
        videos.forEach((v) => setPartitionTag(v, this.showPartitionTag ? selectorFns.partition(v) : undefined))
        if (revertAll) {
            videos.forEach((v) => showEle(v, 'sign'))
            return
        }

        if (config.isDebugMode) {
            videos.forEach((v) => {
                logger.debug(
                    [
                        `VideoFilterVideo`,
                        `bvid: ${selectorFns.bvid(v)}`,
                        `duration: ${selectorFns.duration(v)}`,
                        `title: ${selectorFns.title(v)}`,
                        `uploader: ${selectorFns.uploader(v)}`,
                        `partition: ${selectorFns.partition(v)}`,
                    ].join('\n'),
                )
            })
        }

        // 构建黑白检测任务
        const blackPairs: SubFilterPair[] = []
        this.videoDurationFilter.isEnable && blackPairs.push([this.videoDurationFilter, selectorFns.duration])
        this.videoTitleFilter.isEnable && blackPairs.push([this.videoTitleFilter, selectorFns.title])
        this.videoUploaderFilter.isEnable && blackPairs.push([this.videoUploaderFilter, selectorFns.uploader])
        this.videoUploaderKeywordFilter.isEnable &&
            blackPairs.push([this.videoUploaderKeywordFilter, selectorFns.uploader])
        this.videoPartitionFilter.isEnable && blackPairs.push([this.videoPartitionFilter, selectorFns.partition])

        const whitePairs: SubFilterPair[] = []
        this.videoUploaderWhiteFilter.isEnable && whitePairs.push([this.videoUploaderWhiteFilter, selectorFns.uploader])

        // 检测
        const blackCnt = await coreCheck(videos, true, 'sign', blackPairs, whitePairs)

        // 缓存数据检测，更新__INITIAL_STATE__.related
        // __INITIAL_STATE__.related 与右侧视频列表绑定
        if (enableRelatedCheck && blackCnt) {
            const blackBvids = new Set<string>()
            for (const video of videos) {
                if (isEleHide(video, 'sign')) {
                    const url = video.querySelector('.info > a')?.getAttribute('href')
                    if (url) {
                        const bvid = matchBvid(url)
                        bvid && blackBvids.add(bvid)
                    }
                }
            }
            const rel = unsafeWindow.__INITIAL_STATE__?.related
            if (rel?.length && blackBvids.size) {
                unsafeWindow.__INITIAL_STATE__!.related = rel.filter((v) => !(v.bvid && blackBvids.has(v.bvid)))
            }
        }
        const time = (performance.now() - timer).toFixed(1)
        logger.debug(`VideoFilterVideo hide ${blackCnt} in ${videos.length} videos, mode=${mode}, time=${time}`)
    }

    checkFull() {
        this.check('full').catch((err) => {
            logger.error('VideoFilterVideo check full error', err)
        })
    }

    // checkIncr() {
    //     this.check('incr')
    //         .catch((err) => {
    //             logger.error('VideoFilterVideo check incr error', err)
    //         })
    // }

    observe() {
        waitForEle(
            document,
            '#reco_list, .recommend-list-v1, .recommend-list-container',
            (node: HTMLElement): boolean => {
                return (
                    node.id === 'reco_list' ||
                    ['recommend-list-v1', 'recommend-list-container'].includes(node.className)
                )
            },
        ).then((ele) => {
            if (!ele) {
                return
            }

            logger.debug('VideoFilterVideo target appear')
            this.target = ele
            this.checkFull()

            new MutationObserver(() => {
                this.checkFull() // 播放页始终全量check
            }).observe(this.target, { childList: true, subtree: true })
        })
    }
}

//==================================================================================================

const mainFilter = new VideoFilterVideo()

export const videoFilterVideoEntry = async () => {
    mainFilter.init()
    mainFilter.observe()
}

export const videoFilterVideoGroups: Group[] = [
    {
        name: '时长过滤',
        items: [
            {
                type: 'switch',
                id: GM_KEYS.black.duration.statusKey,
                name: '启用 时长过滤',
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoDurationFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoDurationFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'number',
                id: GM_KEYS.black.duration.valueKey,
                name: '设定最低时长（0~300s）',
                noStyle: true,
                minValue: 0,
                maxValue: 300,
                step: 1,
                defaultValue: 60,
                disableValue: 0,
                addonText: '秒',
                fn: (value: number) => {
                    mainFilter.videoDurationFilter.setParam(value)
                    mainFilter.checkFull()
                },
            },
        ],
    },
    {
        name: 'UP主过滤',
        items: [
            {
                type: 'switch',
                id: GM_KEYS.black.uploader.statusKey,
                name: '启用 UP主过滤 (右键单击UP主)',
                defaultEnable: true,
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoUploaderFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoUploaderFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'editor',
                id: GM_KEYS.black.uploader.valueKey,
                name: '编辑 UP主黑名单',
                description: ['右键屏蔽的UP主会出现在首行'],
                editorTitle: 'UP主 黑名单',
                editorDescription: ['每行一个UP主昵称，保存时自动去重'],
                saveFn: async () => {
                    mainFilter.videoUploaderFilter.setParam(GM_getValue(GM_KEYS.black.uploader.valueKey, []))
                    mainFilter.checkFull()
                },
            },
            {
                type: 'switch',
                id: GM_KEYS.black.uploaderKeyword.statusKey,
                name: '启用 UP主昵称关键词过滤 (右键单击UP主)',
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoUploaderKeywordFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoUploaderKeywordFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'editor',
                id: GM_KEYS.black.uploaderKeyword.valueKey,
                name: '编辑 UP主昵称关键词黑名单',
                description: ['右键可快捷录入关键词，确认后出现在首行'],
                editorTitle: 'UP主昵称关键词 黑名单',
                editorDescription: [
                    '每行一个关键词或正则，不区分大小写、全半角',
                    '请勿使用过于激进的关键词或正则',
                    '正则默认 ius 模式，无需 flag，语法：/abc|\\d+/',
                ],
                saveFn: async () => {
                    mainFilter.videoUploaderKeywordFilter.setParam(
                        GM_getValue(GM_KEYS.black.uploaderKeyword.valueKey, []),
                    )
                    mainFilter.checkFull()
                },
            },
        ],
    },
    {
        name: '标题关键词过滤',
        items: [
            {
                type: 'switch',
                id: GM_KEYS.black.title.statusKey,
                name: '启用 标题关键词过滤 (右键单击标题)',
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoTitleFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoTitleFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'editor',
                id: GM_KEYS.black.title.valueKey,
                name: '编辑 标题关键词黑名单',
                description: ['右键可快捷录入关键词，确认后出现在首行'],
                editorTitle: '标题关键词 黑名单',
                editorDescription: [
                    '每行一个关键词或正则，不区分大小写、全半角',
                    '请勿使用过于激进的关键词或正则',
                    '正则默认 ius 模式，无需 flag，语法：/abc|\\d+/',
                ],
                saveFn: async () => {
                    mainFilter.videoTitleFilter.setParam(GM_getValue(GM_KEYS.black.title.valueKey, []))
                    mainFilter.checkFull()
                },
            },
        ],
    },
    {
        name: '分区过滤',
        items: [
            {
                type: 'switch',
                id: GM_KEYS.black.partition.statusKey,
                name: '启用 分区过滤',
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoPartitionFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoPartitionFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'editor',
                id: GM_KEYS.black.partition.valueKey,
                name: '编辑 分区黑名单',
                description: ['开关和黑名单内容全站共用', '作用于右侧 相关视频 / 接下来播放；分区标签可用于快捷录入'],
                editorTitle: '分区 黑名单',
                editorDescription: [
                    '启用后，右键视频卡片可快捷屏蔽分区',
                    '每行一个分区（ID 名称），如：124 社科·法律·心理',
                    '右键屏蔽会自动附带分区名称，便于识别',
                ],
                valueToLines: partitionValueToLines,
                linesToValue: partitionLinesToValue,
                saveFn: async () => {
                    mainFilter.videoPartitionFilter.setParam(GM_getValue(GM_KEYS.black.partition.valueKey, []))
                    mainFilter.checkFull()
                },
            },
            {
                type: 'switch',
                id: GM_KEYS.black.partitionTag.statusKey,
                name: '显示 分区标签',
                description: ['在相关视频UP主昵称上方显示分区名称与ID'],
                defaultEnable: true,
                noStyle: true,
                enableFn: () => {
                    mainFilter.showPartitionTag = true
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.showPartitionTag = false
                    mainFilter.checkFull()
                },
            },
        ],
    },
    {
        name: '其他过滤',
        items: [
            {
                type: 'switch',
                id: GM_KEYS.black.related.statusKey,
                name: '启用 相关视频数据过滤 (实验功能)',
                description: [
                    '过滤当前视频的"相关视频"缓存数据',
                    '自动替换接下来播放、播放结束相关视频',
                    '启用后，变动其他过滤功能需刷新页面',
                ],
                noStyle: true,
                enableFn: () => {
                    enableRelatedCheck = true
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    enableRelatedCheck = false
                    mainFilter.checkFull()
                },
            },
        ],
    },
    {
        name: '白名单 免过滤',
        items: [
            {
                type: 'switch',
                id: GM_KEYS.white.uploader.statusKey,
                name: '启用 UP主白名单 (右键单击UP主)',
                defaultEnable: true,
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoUploaderWhiteFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoUploaderWhiteFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'editor',
                id: GM_KEYS.white.uploader.valueKey,
                name: '编辑 UP主白名单',
                editorTitle: 'UP主 白名单',
                editorDescription: ['每行一个UP主昵称，保存时自动去重'],
                saveFn: async () => {
                    mainFilter.videoUploaderWhiteFilter.setParam(GM_getValue(GM_KEYS.white.uploader.valueKey, []))
                    mainFilter.checkFull()
                },
            },
        ],
    },
]

// 右键菜单handler
export const videoFilterVideoHandler: ContextMenuTargetHandler = (target: HTMLElement): FilterContextMenu[] => {
    if (!(isPageVideo() || isPagePlaylist() || isPageBangumi())) {
        return []
    }

    const menus: FilterContextMenu[] = []
    // 分区（仅在分区标签上右键触发，避免范围过大）
    const partitionTag = target.closest<HTMLElement>('.bili-cleaner-partition-tag')
    if (partitionTag) {
        const partitionCard = target.closest<HTMLElement>(
            '.recommend-video-card, .video-page-card-small, .video-page-operator-card-small',
        )
        const partition = partitionCard && parsePartitionValue(selectorFns.partition(partitionCard))
        if (partition) {
            menus.push(
                ...buildPartitionContextMenus({
                    partition,
                    isEnable: mainFilter.videoPartitionFilter.isEnable,
                    valueKey: GM_KEYS.black.partition.valueKey,
                    addParam: (value) => mainFilter.videoPartitionFilter.addParam(value),
                    checkFull: () => mainFilter.checkFull(),
                }),
            )
        }
    }
    // UP主
    if (
        target.closest('.right-container, .recommend-list-container, .up-panel-container') &&
        (target.classList.contains('name') ||
            target.classList.contains('up-name') ||
            target.parentElement?.classList.contains('up-name') ||
            target.closest('.staff-info'))
    ) {
        const uploader =
            target.closest('.staff-info')?.querySelector('.staff-name')?.textContent?.trim() ||
            target.textContent?.trim() ||
            target.parentElement?.textContent?.trim()
        const url = target.closest('.upname')?.querySelector(':scope a')?.getAttribute('href')
        const spaceUrl = url?.match(/space\.bilibili\.com\/\d+/)?.[0]

        if (uploader) {
            if (mainFilter.videoUploaderFilter.isEnable) {
                menus.push({
                    name: `屏蔽UP主：${uploader}`,
                    fn: async () => {
                        try {
                            mainFilter.videoUploaderFilter.addParam(uploader)
                            mainFilter.checkFull()
                            const arr: string[] = GM_getValue(GM_KEYS.black.uploader.valueKey, [])
                            arr.unshift(uploader)
                            GM_setValue(GM_KEYS.black.uploader.valueKey, orderedUniq(arr))
                        } catch (err) {
                            logger.error(`videoFilterVideoHandler add uploader ${uploader} failed`, err)
                        }
                    },
                })
            }
            if (mainFilter.videoUploaderKeywordFilter.isEnable) {
                menus.push({
                    name: `录入UP主昵称关键词`,
                    fn: async () => {
                        try {
                            const keywords = await promptKeyword({
                                title: '录入UP主昵称关键词',
                                initialValue: uploader,
                            })
                            if (!keywords) {
                                return
                            }
                            for (const keyword of keywords) {
                                mainFilter.videoUploaderKeywordFilter.addParam(keyword)
                            }
                            mainFilter.checkFull()
                            const arr: string[] = GM_getValue(GM_KEYS.black.uploaderKeyword.valueKey, [])
                            arr.unshift(...keywords)
                            GM_setValue(GM_KEYS.black.uploaderKeyword.valueKey, orderedUniq(arr))
                        } catch (err) {
                            logger.error(`videoFilterVideoHandler add uploader keyword failed`, err)
                        }
                    },
                })
            }
            if (mainFilter.videoUploaderWhiteFilter.isEnable) {
                menus.push({
                    name: `将UP主加入白名单`,
                    fn: async () => {
                        try {
                            mainFilter.videoUploaderWhiteFilter.addParam(uploader)
                            mainFilter.checkFull()
                            const arr: string[] = GM_getValue(GM_KEYS.white.uploader.valueKey, [])
                            arr.unshift(uploader)
                            GM_setValue(GM_KEYS.white.uploader.valueKey, orderedUniq(arr))
                        } catch (err) {
                            logger.error(`videoFilterVideoHandler add white uploader ${uploader} failed`, err)
                        }
                    },
                })
            }
        }
        if (
            spaceUrl &&
            (mainFilter.videoUploaderFilter.isEnable ||
                mainFilter.videoUploaderKeywordFilter.isEnable ||
                mainFilter.videoUploaderWhiteFilter.isEnable)
        ) {
            menus.push({
                name: `复制主页链接`,
                fn: () => navigator.clipboard.writeText(`https://${spaceUrl}`),
            })
        }
    }
    // 标题 / BVID
    if (target.closest('.right-container, .recommend-list-container') && target.classList.contains('title')) {
        const title = target.getAttribute('title')?.trim() || target.textContent?.trim()
        if (title && mainFilter.videoTitleFilter.isEnable) {
            menus.push({
                name: `录入标题关键词`,
                fn: async () => {
                    try {
                        const keywords = await promptKeyword({
                            title: '录入标题关键词',
                            initialValue: title,
                        })
                        if (!keywords) {
                            return
                        }
                        for (const keyword of keywords) {
                            mainFilter.videoTitleFilter.addParam(keyword)
                        }
                        mainFilter.checkFull()
                        const arr: string[] = GM_getValue(GM_KEYS.black.title.valueKey, [])
                        arr.unshift(...keywords)
                        GM_setValue(GM_KEYS.black.title.valueKey, orderedUniq(arr))
                    } catch (err) {
                        logger.error(`videoFilterVideoHandler add title keyword failed`, err)
                    }
                },
            })
        }
    }
    return menus
}
