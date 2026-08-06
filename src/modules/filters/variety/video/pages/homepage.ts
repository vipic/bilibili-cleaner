import { coreCheck } from '@/modules/filters/core/core'
import config from '@/config'
import { Group } from '@/types/collection'
import { ContextMenuTargetHandler, FilterContextMenu, IMainFilter, SelectorResult, SubFilterPair } from '@/types/filter'
import { logger } from '@/utils/logger'
import { isPageHomepage } from '@/utils/pageType'
import { GM_getValue, GM_setValue } from '$'
import { promptKeyword } from '@/utils/keywordPrompt'
import { convertDateToDays, convertTimeToSec, matchBvid, orderedUniq, showEle, waitForEle } from '@/utils/tool'
import {
    VideoDurationFilter,
    VideoPartitionFilter,
    VideoPubdateFilter,
    VideoTitleFilter,
    VideoUploaderFilter,
    VideoUploaderKeywordFilter,
    VideoViewsFilter,
} from '../subFilters/black'
import { VideoIsFollowWhiteFilter, VideoUploaderWhiteFilter } from '../subFilters/white'
import {
    buildPartitionContextMenus,
    parsePartitionValue,
    partitionLinesToValue,
    partitionValueToLines,
    setPartitionTag,
} from '../partition'
import { ensurePartition, getPartition } from '../homepagePartition'

const GM_KEYS = {
    black: {
        duration: {
            statusKey: 'homepage-duration-filter-status',
            valueKey: 'global-duration-filter-value',
        },
        views: {
            statusKey: 'homepage-views-filter-status',
            valueKey: 'global-views-filter-value',
        },
        uploader: {
            statusKey: 'homepage-uploader-filter-status',
            valueKey: 'global-uploader-filter-value',
        },
        uploaderKeyword: {
            statusKey: 'homepage-uploader-keyword-filter-status',
            valueKey: 'global-uploader-keyword-filter-value',
        },
        pubdate: {
            statusKey: 'homepage-pubdate-filter-status',
            valueKey: 'global-pubdate-filter-value',
        },
        title: {
            statusKey: 'homepage-title-keyword-filter-status',
            valueKey: 'global-title-keyword-filter-value',
        },
        partition: {
            statusKey: 'homepage-partition-filter-status',
            valueKey: 'global-partition-filter-value',
        },
        partitionTag: {
            statusKey: 'homepage-partition-tag-status',
        },
    },
    white: {
        uploader: {
            statusKey: 'homepage-uploader-whitelist-filter-status',
            valueKey: 'global-uploader-whitelist-filter-value',
        },
        isFollow: {
            statusKey: 'homepage-following-whitelist-filter-status',
        },
    },
}

// 视频信息提取函数
const selectorFns = {
    duration: (video: HTMLElement): SelectorResult => {
        const duration = video.querySelector('.bili-video-card__stats__duration')?.textContent?.trim()
        return duration && convertTimeToSec(duration)
    },
    views: (video: HTMLElement): SelectorResult => {
        const text = video.querySelector('.bili-video-card__stats--text')?.textContent?.trim()
        if (text) {
            if (/\d+(?:\.\d+)?万/.test(text)) {
                return parseFloat(text.replace('万', '')) * 10000
            }
            if (/^\d+$/.test(text)) {
                return parseFloat(text)
            }
        }
        return undefined
    },
    title: (video: HTMLElement): SelectorResult => {
        return video.querySelector('.bili-video-card__info--tit a')?.textContent?.trim()
    },
    pubdate: (video: HTMLElement): SelectorResult => {
        const pubdate = video.querySelector('.bili-video-card__info--date')?.textContent?.trim()
        return pubdate && convertDateToDays(pubdate)
    },
    bvid: (video: HTMLElement): SelectorResult => {
        const href =
            video.querySelector('.bili-video-card__info--tit a')?.getAttribute('href') ||
            video.querySelector('.bili-video-card__image--link')?.getAttribute('href') ||
            video.querySelector('a[href*="/video/"]')?.getAttribute('href') ||
            video.getAttribute('href')
        return (href && matchBvid(href)) ?? undefined
    },
    uploader: (video: HTMLElement): SelectorResult => {
        return video.querySelector('.bili-video-card__info--author')?.textContent?.trim()
    },
    partition: (video: HTMLElement): SelectorResult => {
        const bvid = selectorFns.bvid(video)
        return typeof bvid === 'string' ? getPartition(bvid) : undefined
    },
    isFollow: (video: HTMLElement): SelectorResult => {
        return video.querySelector('.bili-video-card__info--icon-text')?.textContent?.trim() === '已关注'
    },
}

class VideoFilterHomepage implements IMainFilter {
    target: HTMLElement | undefined

    // 黑名单
    videoDurationFilter = new VideoDurationFilter()
    videoViewsFilter = new VideoViewsFilter()
    videoTitleFilter = new VideoTitleFilter()
    videoPubdateFilter = new VideoPubdateFilter()
    videoUploaderFilter = new VideoUploaderFilter()
    videoUploaderKeywordFilter = new VideoUploaderKeywordFilter()
    videoPartitionFilter = new VideoPartitionFilter()
    // 显示分区标签
    showPartitionTag = false

    // 白名单
    videoUploaderWhiteFilter = new VideoUploaderWhiteFilter()
    videoIsFollowWhiteFilter = new VideoIsFollowWhiteFilter()

    init() {
        // 黑名单
        this.videoDurationFilter.setParam(GM_getValue(GM_KEYS.black.duration.valueKey, 0))
        this.videoViewsFilter.setParam(GM_getValue(GM_KEYS.black.views.valueKey, 0))
        this.videoTitleFilter.setParam(GM_getValue(GM_KEYS.black.title.valueKey, []))
        this.videoPubdateFilter.setParam(GM_getValue(GM_KEYS.black.pubdate.valueKey, 0))
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
            this.videoViewsFilter.isEnable ||
            this.videoTitleFilter.isEnable ||
            this.videoUploaderFilter.isEnable ||
            this.videoUploaderKeywordFilter.isEnable ||
            this.videoPubdateFilter.isEnable
        )) {
            revertAll = true
        }
        const timer = performance.now()

        // 顶部推荐位 + rcmd视频流
        let selector = `:scope > :is(.feed-card, .bili-video-card.is-rcmd, .bili-feed-card)`
        if (mode === 'incr') {
            selector += `:not([${config.filterVisitSign}])`
        }
        const videos = Array.from(this.target.querySelectorAll<HTMLElement>(selector))
        if (!videos.length) {
            return
        }

        // 分区：首页推荐数据不含分区，需按bvid抓取view接口
        const partitionFilterOn = this.videoPartitionFilter.isEnable
        const tagOn = this.showPartitionTag
        if (partitionFilterOn || tagOn) {
            const bvids = videos.map((v) => selectorFns.bvid(v)).filter((b): b is string => typeof b === 'string')
            if (bvids.length) {
                const ensurePromise = ensurePartition(bvids)
                if (partitionFilterOn) {
                    // 过滤需要分区数据就绪后再检测
                    await ensurePromise
                } else {
                    // 仅标签：后台抓取，就绪后直接更新本批视频标签
                    // （不能重跑checkFull——ensurePartition恒返回已决议的promise，会自我触发形成死循环卡死页面）
                    ensurePromise
                        .then(() => {
                            videos.forEach((v) => setPartitionTag(v, selectorFns.partition(v), 'after-date'))
                        })
                        .catch(() => {})
                }
            }
        }
        // 分区标签（首页：跟在昵称行上传时间后面，形成 昵称 上传时间 分区 左右排列）
        if (tagOn) {
            videos.forEach((v) => setPartitionTag(v, selectorFns.partition(v), 'after-date'))
        }
        if (revertAll) {
            videos.forEach((v) => showEle(v, 'sign'))
            return
        }

        if (config.isDebugMode) {
            videos.forEach((v) => {
                logger.debug(
                    [
                        `VideoFilterHomepage`,
                        `bvid: ${selectorFns.bvid(v)}`,
                        `duration: ${selectorFns.duration(v)}`,
                        `views: ${selectorFns.views(v)}`,
                        `title: ${selectorFns.title(v)}`,
                        `uploader: ${selectorFns.uploader(v)}`,
                        `pubdate: ${selectorFns.pubdate(v)}`,
                        `partition: ${selectorFns.partition(v)}`,
                        `isFollow: ${selectorFns.isFollow(v)}`,
                    ].join('\n'),
                )
            })
        }

        // 构建黑白检测任务
        const blackPairs: SubFilterPair[] = []
        this.videoDurationFilter.isEnable && blackPairs.push([this.videoDurationFilter, selectorFns.duration])
        this.videoViewsFilter.isEnable && blackPairs.push([this.videoViewsFilter, selectorFns.views])
        this.videoTitleFilter.isEnable && blackPairs.push([this.videoTitleFilter, selectorFns.title])
        this.videoPubdateFilter.isEnable && blackPairs.push([this.videoPubdateFilter, selectorFns.pubdate])
        this.videoUploaderFilter.isEnable && blackPairs.push([this.videoUploaderFilter, selectorFns.uploader])
        this.videoUploaderKeywordFilter.isEnable &&
            blackPairs.push([this.videoUploaderKeywordFilter, selectorFns.uploader])
        this.videoPartitionFilter.isEnable && blackPairs.push([this.videoPartitionFilter, selectorFns.partition])

        const whitePairs: SubFilterPair[] = []
        this.videoUploaderWhiteFilter.isEnable && whitePairs.push([this.videoUploaderWhiteFilter, selectorFns.uploader])
        this.videoIsFollowWhiteFilter.isEnable && whitePairs.push([this.videoIsFollowWhiteFilter, selectorFns.isFollow])

        // 检测
        const blackCnt = await coreCheck(videos, true, 'sign', blackPairs, whitePairs)
        const time = (performance.now() - timer).toFixed(1)
        logger.debug(`VideoFilterHomepage hide ${blackCnt} in ${videos.length} videos, mode=${mode}, time=${time}`)
    }

    checkFull() {
        this.check('full').catch((err) => {
            logger.error('VideoFilterHomepage check full error', err)
        })
    }

    checkIncr() {
        this.check('incr').catch((err) => {
            logger.error('VideoFilterHomepage check incr error', err)
        })
    }

    observe() {
        waitForEle(document, '.container', (node: HTMLElement): boolean => {
            return node.classList.contains('container')
        }).then((ele) => {
            if (!ele) {
                return
            }

            logger.debug('VideoFilterHomepage target appear')
            this.target = ele
            this.checkFull()

            new MutationObserver(() => {
                this.checkIncr()
            }).observe(this.target, { childList: true })
        })
    }
}

//==================================================================================================

const mainFilter = new VideoFilterHomepage()

export const videoFilterHomepageEntry = async () => {
    mainFilter.init()
    mainFilter.observe()

    // 首页后缀问题提示
    const checkHomepageSuffix = () => {
        if (
            location.pathname.startsWith('/index.html') &&
            (mainFilter.videoDurationFilter.isEnable ||
                mainFilter.videoViewsFilter.isEnable ||
                mainFilter.videoTitleFilter.isEnable ||
                mainFilter.videoUploaderFilter.isEnable ||
                mainFilter.videoUploaderKeywordFilter.isEnable ||
                mainFilter.videoPubdateFilter.isEnable)
        ) {
            alert(
                `[bilibili-cleaner] 视频过滤在当前首页不生效\n当前网址包含 index.html 后缀\n请使用无后缀首页 https://www.bilibili.com/`,
            )
        }
    }
    if (document.readyState === 'complete') {
        checkHomepageSuffix()
    } else {
        window.addEventListener('load', checkHomepageSuffix)
    }
}

export const videoFilterHomepageGroups: Group[] = [
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
        name: '发布日期过滤',
        fold: true,
        items: [
            {
                type: 'switch',
                id: GM_KEYS.black.pubdate.statusKey,
                name: '启用 发布日期过滤',
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoPubdateFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoPubdateFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'number',
                id: GM_KEYS.black.pubdate.valueKey,
                name: '视频发布日 距今不超过',
                noStyle: true,
                minValue: 0,
                maxValue: 500,
                step: 1,
                defaultValue: 60,
                disableValue: 0,
                addonText: '天',
                fn: (value: number) => {
                    mainFilter.videoPubdateFilter.setParam(value)
                    mainFilter.checkFull()
                },
            },
        ],
    },
    {
        name: '播放量过滤',
        fold: true,
        items: [
            {
                type: 'switch',
                id: GM_KEYS.black.views.statusKey,
                name: '启用 播放量过滤',
                description: ['不推荐启用', '会导致刚发布的优质视频被过滤'],
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoViewsFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoViewsFilter.disable()
                    mainFilter.checkFull()
                },
            },
            {
                type: 'number',
                id: GM_KEYS.black.views.valueKey,
                name: '设定最低播放量（0~10万）',
                noStyle: true,
                minValue: 0,
                maxValue: 100000,
                step: 1,
                defaultValue: 0,
                disableValue: 0,
                addonText: '次',
                fn: (value: number) => {
                    mainFilter.videoViewsFilter.setParam(value)
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
                description: [
                    '黑名单内容全站共用，开关仅对本页生效',
                    '首页推荐数据不含分区，需按视频请求接口，首次加载稍慢',
                ],
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
                description: ['在昵称行（上传时间后）显示分区名称与ID，形成 昵称 上传时间 分区 左右排列'],
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
                id: GM_KEYS.white.isFollow.statusKey,
                name: '标有 [已关注] 的视频免过滤',
                defaultEnable: true,
                noStyle: true,
                enableFn: () => {
                    mainFilter.videoIsFollowWhiteFilter.enable()
                    mainFilter.checkFull()
                },
                disableFn: () => {
                    mainFilter.videoIsFollowWhiteFilter.disable()
                    mainFilter.checkFull()
                },
            },
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
export const videoFilterHomepageHandler: ContextMenuTargetHandler = (target: HTMLElement): FilterContextMenu[] => {
    if (!isPageHomepage()) {
        return []
    }

    const menus: FilterContextMenu[] = []
    // 分区（仅在分区标签上右键触发，避免范围过大）
    if (target.closest('.bili-cleaner-partition-tag')) {
        const partitionCard = target.closest<HTMLElement>('.bili-video-card, .feed-card, .bili-feed-card')
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
    // UP主（排除分区标签区域，标签右键只弹分区菜单）
    if (target.closest('.bili-video-card__info--owner') && !target.closest('.bili-cleaner-partition-tag')) {
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
                            logger.error(`videoFilterHomepageHandler add uploader ${uploader} failed`, err)
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
                            logger.error(`videoFilterHomepageHandler add uploader keyword failed`, err)
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
                            logger.error(`videoFilterHomepageHandler add white uploader ${uploader} failed`, err)
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
                fn: () => navigator.clipboard.writeText(`https://${spaceUrl}`).catch(() => {}),
            })
        }
    }
    // 标题 / BVID
    if (target.classList.contains('bili-video-card__info--tit') || target.closest('.bili-video-card__info--tit')) {
        const titleEl = target.closest('.bili-video-card__info--tit')
        const title =
            titleEl?.querySelector('a')?.getAttribute('title')?.trim() ||
            titleEl?.querySelector('a')?.textContent?.trim() ||
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
                        logger.error(`videoFilterHomepageHandler add title keyword failed`, err)
                    }
                },
            })
        }
    }
    return menus
}
