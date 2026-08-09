import { coreCheck } from '@/modules/filters/core/core'
import config from '@/config'
import fetchHook from '@/utils/fetch'
import { Group } from '@/types/collection'
import { ContextMenuTargetHandler, FilterContextMenu, IMainFilter, SelectorResult, SubFilterPair } from '@/types/filter'
import { logger } from '@/utils/logger'
import { isPageSearch } from '@/utils/pageType'
import { GM_getValue, GM_setValue } from '$'
import { promptKeyword } from '@/utils/keywordPrompt'
import { convertTimeToSec, matchBvid, orderedUniq, showEle, waitForEle } from '@/utils/tool'
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
            statusKey: 'search-duration-filter-status',
            valueKey: 'global-duration-filter-value',
        },
        uploader: {
            statusKey: 'search-uploader-filter-status',
            valueKey: 'global-uploader-filter-value',
        },
        uploaderKeyword: {
            statusKey: 'search-uploader-keyword-filter-status',
            valueKey: 'global-uploader-keyword-filter-value',
        },
        title: {
            statusKey: 'search-title-keyword-filter-status',
            valueKey: 'global-title-keyword-filter-value',
        },
        partition: {
            statusKey: 'search-partition-filter-status',
            valueKey: 'global-partition-filter-value',
        },
        partitionTag: {
            statusKey: 'search-partition-tag-status',
        },
    },
    white: {
        uploader: {
            statusKey: 'search-uploader-whitelist-filter-status',
            valueKey: 'global-uploader-whitelist-filter-value',
        },
    },
}

// 视频列表信息提取
const selectorFns = {
    duration: (video: HTMLElement): SelectorResult => {
        const duration = video.querySelector('.bili-video-card__stats__duration')?.textContent?.trim()
        return (duration && convertTimeToSec(duration)) ?? undefined
    },
    title: (video: HTMLElement): SelectorResult => {
        return video.querySelector('.bili-video-card__info--tit')?.textContent?.trim()
    },
    bvid: (video: HTMLElement): SelectorResult => {
        const href =
            video.querySelector('.bili-video-card__wrap > a')?.getAttribute('href') ||
            video.querySelector('.bili-video-card__info--right > a')?.getAttribute('href')
        return (href && matchBvid(href)) ?? undefined
    },
    uploader: (video: HTMLElement): SelectorResult => {
        return (
            video.querySelector('.bili-video-card__info--author')?.textContent?.trim() ||
            video.closest('.user-list')?.querySelector('.user-name')?.textContent?.trim()
        )
    },
    uploaderCard: (userCard: HTMLElement): SelectorResult => {
        return userCard.querySelector('.user-name')?.textContent?.trim()
    },
    partition: (video: HTMLElement): SelectorResult => {
        const bvid = selectorFns.bvid(video)
        return (typeof bvid === 'string' && searchPartitionMap.get(bvid)) ?? undefined
    },
}

// 搜索结果 分区缓存数据 (bvid -> `${typeid}|${typename}`)，通过hook搜索结果接口获取
const searchPartitionMap = new Map<string, string>()
let searchPartitionHookInited = false
const initSearchPartitionHook = () => {
    if (searchPartitionHookInited) {
        return
    }
    searchPartitionHookInited = true
    fetchHook.addPostFn(async (input, _init, resp) => {
        try {
            if (typeof input !== 'string' || !input.includes('search/type')) {
                return
            }
            const data: any = await resp?.clone().json()
            const result = data?.data?.result
            if (!Array.isArray(result)) {
                return
            }
            for (const v of result) {
                if (v?.bvid && (v.typeid || v.typename)) {
                    searchPartitionMap.set(v.bvid, [v.typeid, v.typename].join('|'))
                }
            }
        } catch (err) {
            logger.error('search partition hook error', err)
        }
    })
}

class VideoFilterSearch implements IMainFilter {
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

        // 提取元素
        const selector = `:where(.video.search-all-list, .search-page-video) .video-list > div`
        const cardSelector = `.user-list .video-list-item`
        const videos = [
            ...this.target.querySelectorAll<HTMLElement>(selector),
            ...document.querySelectorAll<HTMLElement>(cardSelector),
        ]

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
                        `VideoFilterSearch`,
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
        const time = (performance.now() - timer).toFixed(1)
        logger.debug(`VideoFilterSearch hide ${blackCnt} in ${videos.length} videos, mode=${mode}, time=${time}`)
    }

    // 类似上面的check方法
    async checkUserCards(mode?: 'full' | 'incr') {
        if (!this.target) {
            return
        }

        const timer = performance.now()
        // 此元素应该至多一个，命名看上去是多个
        const userList = this.target.querySelector<HTMLDivElement>('.user-list')
        if (!userList) {
            return
        }
        const userName = userList.querySelector<HTMLAnchorElement>('a.user-name')?.textContent?.trim()
        if (!userName) {
            return
        }
        if (
            !this.videoUploaderFilter.isEnable &&
            !this.videoUploaderKeywordFilter.isEnable &&
            !this.videoUploaderWhiteFilter.isEnable
        ) {
            showEle(userList, 'sign')
            return
        }

        if (config.isDebugMode) {
            logger.debug([`VideoFilterSearchUserCard`, `uploader: ${userName}`].join('\n'))
        }

        const blackPairs: SubFilterPair[] = []
        this.videoUploaderFilter.isEnable && blackPairs.push([this.videoUploaderFilter, selectorFns.uploaderCard])
        this.videoUploaderKeywordFilter.isEnable &&
            blackPairs.push([this.videoUploaderKeywordFilter, selectorFns.uploaderCard])

        const whitePairs: SubFilterPair[] = []
        this.videoUploaderWhiteFilter.isEnable &&
            whitePairs.push([this.videoUploaderWhiteFilter, selectorFns.uploaderCard])

        const blackCnt = await coreCheck([userList], true, 'sign', blackPairs, whitePairs)
        const time = (performance.now() - timer).toFixed(1)
        logger.debug(`VideoFilterSearchUserCard hide ${blackCnt} in user-list, mode=${mode}, time=${time}`)
    }

    checkFull() {
        // 用户卡片检测（搜索页的 div.user-list）
        this.checkUserCards('full').catch((err) => {
            logger.error('VideoFilterSearch checkUserList error', err)
        })
        // 搜索页视频列表检测
        this.check('full').catch((err) => {
            logger.error('VideoFilterSearch check full error', err)
        })
    }

    // checkIncr() {
    //     this.check('incr')
    //         .catch((err) => {
    //             logger.error('VideoFilterSearch check incr error', err)
    //         })
    // }

    observe() {
        waitForEle(document, '.search-layout', (node: HTMLElement): boolean => {
            return node.className.includes('search-layout')
        }).then((ele) => {
            if (!ele) {
                return
            }

            logger.debug('VideoFilterSearch target appear')
            this.target = ele
            this.checkFull()

            new MutationObserver(() => {
                this.checkFull() // 搜索页始终全量check
            }).observe(this.target, { childList: true, subtree: true })
        })
    }
}

//==================================================================================================

const mainFilter = new VideoFilterSearch()

export const videoFilterSearchEntry = async () => {
    initSearchPartitionHook()
    mainFilter.init()
    mainFilter.observe()
}

export const videoFilterSearchGroups: Group[] = [
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
                description: ['黑名单内容全站共用，开关仅对本页生效'],
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
export const videoFilterSearchHandler: ContextMenuTargetHandler = (target: HTMLElement): FilterContextMenu[] => {
    if (!isPageSearch()) {
        return []
    }

    const menus: FilterContextMenu[] = []
    // 分区（仅在分区标签上右键触发，避免范围过大）
    if (target.closest('.bili-cleaner-partition-tag')) {
        const partitionCard = target.closest<HTMLElement>('.bili-video-card')
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
    if (target.closest('.bili-video-card__info--owner')) {
        const uploader = target
            .closest('.bili-video-card__info--owner')
            ?.querySelector('.bili-video-card__info--author')
            ?.textContent?.trim()
        const url = target.closest<HTMLAnchorElement>('.bili-video-card__info--owner')?.href.trim()
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
                            logger.error(`videoFilterSearchHandler add uploader ${uploader} failed`, err)
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
                            logger.error(`videoFilterSearchHandler add uploader keyword failed`, err)
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
                            logger.error(`videoFilterSearchHandler add white uploader ${uploader} failed`, err)
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

    // 搜索页同名用户卡片
    if (target.closest('div.user-list .info-card')) {
        const userList = target.closest('div.user-list')
        const userAnchor = userList?.querySelector<HTMLAnchorElement>('a.user-name')
        const uploader = userAnchor?.textContent?.trim()
        const url = userAnchor?.href.trim()
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
                            logger.error(`videoFilterSearchHandler add uploader ${uploader} failed`, err)
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
                            logger.error(`videoFilterSearchHandler add uploader keyword failed`, err)
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
                            logger.error(`videoFilterSearchHandler add white uploader ${uploader} failed`, err)
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
    if (target.classList.contains('bili-video-card__info--tit') || target.closest('.bili-video-card__info--tit')) {
        const titleEl = target.closest('.bili-video-card__info--tit')
        const title =
            titleEl?.querySelector('a')?.getAttribute('title')?.trim() ||
            titleEl?.getAttribute('title')?.trim() ||
            titleEl?.textContent?.trim()
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
                        logger.error(`videoFilterSearchHandler add title keyword failed`, err)
                    }
                },
            })
        }
    }
    return menus
}
