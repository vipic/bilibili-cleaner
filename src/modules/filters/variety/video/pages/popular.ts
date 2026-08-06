import { coreCheck } from '@/modules/filters/core/core'
import config from '@/config'
import { Group } from '@/types/collection'
import { ContextMenuTargetHandler, FilterContextMenu, IMainFilter, SelectorResult, SubFilterPair } from '@/types/filter'
import { logger } from '@/utils/logger'
import { isPagePopular } from '@/utils/pageType'
import { GM_getValue, GM_setValue } from '$'
import { promptKeyword } from '@/utils/keywordPrompt'
import { calcQuality, orderedUniq, showEle, waitForEle } from '@/utils/tool'
import {
    VideoDimensionFilter,
    VideoDurationFilter,
    VideoPartitionFilter,
    VideoQualityFilter,
    VideoTitleFilter,
    VideoUploaderFilter,
    VideoUploaderKeywordFilter,
} from '../subFilters/black'
import { VideoUploaderWhiteFilter } from '../subFilters/white'
import { buildPartitionContextMenus, parsePartitionValue, setPartitionTag } from '../partition'

const GM_KEYS = {
    black: {
        duration: {
            statusKey: 'popular-duration-filter-status',
            valueKey: 'global-duration-filter-value',
        },
        uploader: {
            statusKey: 'popular-uploader-filter-status',
            valueKey: 'global-uploader-filter-value',
        },
        uploaderKeyword: {
            statusKey: 'popular-uploader-keyword-filter-status',
            valueKey: 'global-uploader-keyword-filter-value',
        },
        title: {
            statusKey: 'popular-title-keyword-filter-status',
            valueKey: 'global-title-keyword-filter-value',
        },
        quality: {
            statusKey: 'popular-quality-filter-status',
            valueKey: 'global-quality-filter-value',
        },
        dimension: {
            statusKey: 'popular-dimension-filter-status',
        },
        partition: {
            statusKey: 'popular-partition-filter-status',
            valueKey: 'global-partition-filter-value',
        },
        partitionTag: {
            statusKey: 'popular-partition-tag-status',
        },
    },
    white: {
        uploader: {
            statusKey: 'popular-uploader-whitelist-filter-status',
            valueKey: 'global-uploader-whitelist-filter-value',
        },
    },
}

// 视频列表信息提取
const getVideoData = (video: HTMLElement): any => {
    let videoData
    if (!video.classList.contains('rank-item')) {
        // 热门视频、每周必看
        return (video as any).__vue__?.videoData
    }
    // 排行榜页
    const rank = video.getAttribute('data-rank')
    if (rank && parseInt(rank) > 0) {
        videoData = (video.closest('.rank-list-wrap') as any)?.__vue__?.list?.[parseInt(rank) - 1]
    }
    return videoData
}
const selectorFns = {
    title: (video: HTMLElement): SelectorResult => {
        return getVideoData(video)?.title
    },
    uploader: (video: HTMLElement): SelectorResult => {
        return getVideoData(video)?.owner?.name
    },
    duration: (video: HTMLElement): SelectorResult => {
        return getVideoData(video)?.duration
    },
    quality: (video: HTMLElement): SelectorResult => {
        const stat = getVideoData(video)?.stat
        if (stat && typeof stat.coin === 'number' && typeof stat.like === 'number') {
            return calcQuality(stat.coin / stat.like)
        }
        return undefined
    },
    // true竖屏, false横屏
    dimension: (video: HTMLElement): SelectorResult => {
        const dimension = getVideoData(video)?.dimension
        if (dimension && typeof dimension.height === 'number' && typeof dimension.width === 'number') {
            return dimension?.height > dimension?.width
        }
        return undefined
    },
    partition: (video: HTMLElement): SelectorResult => {
        const data = getVideoData(video)
        return data ? [data.tid, data.tname].join('|') : undefined
    },
}

class VideoFilterPopular implements IMainFilter {
    target: HTMLElement | undefined

    // 黑名单
    videoDurationFilter = new VideoDurationFilter()
    videoTitleFilter = new VideoTitleFilter()
    videoUploaderFilter = new VideoUploaderFilter()
    videoUploaderKeywordFilter = new VideoUploaderKeywordFilter()
    videoQualityFilter = new VideoQualityFilter()
    videoDimensionFilter = new VideoDimensionFilter()
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
        this.videoQualityFilter.setParam(GM_getValue(GM_KEYS.black.quality.valueKey, 0))
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
            this.videoDimensionFilter.isEnable ||
            this.videoQualityFilter.isEnable ||
            this.videoPartitionFilter.isEnable
        )) {
            revertAll = true
        }
        const timer = performance.now()

        // 提取元素
        const selector = `.card-list .video-card, .video-list .video-card, .rank-list:not(.pgc-list) .rank-item`
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
                        `VideoFilterPopular`,
                        `duration: ${selectorFns.duration(v)}`,
                        `title: ${selectorFns.title(v)}`,
                        `uploader: ${selectorFns.uploader(v)}`,
                        `quality: ${selectorFns.quality(v)}`,
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
        this.videoDimensionFilter.isEnable && blackPairs.push([this.videoDimensionFilter, selectorFns.dimension])
        this.videoQualityFilter.isEnable && blackPairs.push([this.videoQualityFilter, selectorFns.quality])
        this.videoPartitionFilter.isEnable && blackPairs.push([this.videoPartitionFilter, selectorFns.partition])

        const whitePairs: SubFilterPair[] = []
        this.videoUploaderWhiteFilter.isEnable && whitePairs.push([this.videoUploaderWhiteFilter, selectorFns.uploader])

        // 检测
        const blackCnt = await coreCheck(videos, true, 'sign', blackPairs, whitePairs)
        const time = (performance.now() - timer).toFixed(1)
        logger.debug(`VideoFilterPopular hide ${blackCnt} in ${videos.length} videos, mode=${mode}, time=${time}`)
    }

    checkFull() {
        this.check('full').catch((err) => {
            logger.error('VideoFilterPopular check full error', err)
        })
    }

    // checkIncr() {
    //     this.check('incr')
    //         .catch((err) => {
    //             logger.error('VideoFilterPopular check incr error', err)
    //         })
    // }

    observe() {
        waitForEle(document, '#app', (node: HTMLElement): boolean => {
            return node.id === 'app'
        }).then((ele) => {
            if (!ele) {
                return
            }

            logger.debug('VideoFilterPopular target appear')
            this.target = ele
            this.checkFull()

            new MutationObserver(() => {
                this.checkFull() // 始终全量
            }).observe(this.target, { childList: true, subtree: true })
        })
    }
}

//==================================================================================================

const mainFilter = new VideoFilterPopular()

export const videoFilterPopularEntry = async () => {
    mainFilter.init()
    mainFilter.observe()
}

export const videoFilterPopularGroups: Group[] = [
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
        name: '视频质量过滤',
        items: [
            {
                type: 'switch',
                id: GM_KEYS.black.dimension.statusKey,
                name: '启用 竖屏视频过滤',
                defaultEnable: true,
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoDimensionFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoDimensionFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'switch',
                id: GM_KEYS.black.quality.statusKey,
                name: '启用 劣质视频过滤',
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoQualityFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoQualityFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'number',
                id: GM_KEYS.black.quality.valueKey,
                name: '劣质视频过滤百分比 (0~80%)',
                noStyle: true,
                minValue: 0,
                maxValue: 80,
                step: 0.1,
                defaultValue: 25,
                disableValue: 0,
                addonText: '%',
                fn: (value: number) => {
                    mainFilter.videoQualityFilter.setParam(value)
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
                description: ['黑名单内容全站共用，开关仅对本页生效', '数据来自页面缓存，可能缺少个别视频分区'],
                editorTitle: '分区 黑名单',
                editorDescription: [
                    '启用后，右键视频卡片可快捷屏蔽分区',
                    '每行一个分区ID，精确屏蔽该分区',
                    '分区ID 参考：17 单机游戏 | 21 日常 | 24 MAD·AMV | 124 社科·法律·心理',
                    '138 搞笑 | 172 手机游戏 | 182 影视杂谈 | 201 科学科普',
                ],
                saveFn: async () => {
                    mainFilter.videoPartitionFilter.setParam(GM_getValue(GM_KEYS.black.partition.valueKey, []))
                    mainFilter.checkFull()
                },
            },
            {
                type: 'switch',
                id: GM_KEYS.black.partitionTag.statusKey,
                name: '显示 分区标签',
                description: ['在UP主昵称上方显示分区名称与ID，便于识别与录入黑名单'],
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
export const videoFilterPopularHandler: ContextMenuTargetHandler = (target: HTMLElement): FilterContextMenu[] => {
    if (!isPagePopular()) {
        return []
    }

    const menus: FilterContextMenu[] = []
    // 分区（仅在分区标签上右键触发，避免范围过大）
    if (target.closest('.bili-cleaner-partition-tag')) {
        const partitionCard = target.closest<HTMLElement>('.video-card, .rank-item')
        if (partitionCard) {
            const partition = parsePartitionValue(selectorFns.partition(partitionCard))
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
    }
    // UP主
    if (target.closest('.up-name')) {
        const uploader = target.textContent?.trim()
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
                            logger.error(`videoFilterPopularHandler add uploader ${uploader} failed`, err)
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
                            logger.error(`videoFilterPopularHandler add uploader keyword failed`, err)
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
                            logger.error(`videoFilterPopularHandler add white uploader ${uploader} failed`, err)
                        }
                    },
                })
            }
        }
    }
    // 标题关键词（仅标题，不含封面）
    if ((target.classList.contains('title') && target.closest('.info a')) || target.classList.contains('video-name')) {
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
                        logger.error(`videoFilterPopularHandler add title keyword failed`, err)
                    }
                },
            })
        }
    }
    return menus
}
