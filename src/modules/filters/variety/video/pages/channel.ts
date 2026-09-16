import { coreCheck } from '@/modules/filters/core/core'
import config from '@/config'
import { Group } from '@/types/collection'
import { ContextMenuTargetHandler, FilterContextMenu, IMainFilter, SelectorResult, SubFilterPair } from '@/types/filter'
import { logger } from '@/utils/logger'
import { isPageChannel } from '@/utils/pageType'
import { GM_getValue, GM_setValue } from '$'
import { promptKeyword } from '@/utils/keywordPrompt'
import { convertDateToDays, convertTimeToSec, orderedUniq, showEle, waitForEle } from '@/utils/tool'
import {
    VideoDurationFilter,
    VideoPubdateFilter,
    VideoTitleFilter,
    VideoUploaderFilter,
    VideoUploaderKeywordFilter,
} from '../subFilters/black'
import { VideoUploaderWhiteFilter } from '../subFilters/white'

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
        pubdate: {
            statusKey: 'global-pubdate-filter-status',
            valueKey: 'global-pubdate-filter-value',
        },
        title: {
            statusKey: 'global-title-keyword-filter-status',
            valueKey: 'global-title-keyword-filter-value',
        },
    },
    white: {
        uploader: {
            statusKey: 'global-uploader-whitelist-filter-status',
            valueKey: 'global-uploader-whitelist-filter-value',
        },
    },
}

// 视频列表信息提取
const selectorFns = {
    duration: (video: HTMLElement): SelectorResult => {
        const duration = video
            .querySelector('.bili-cover-card__stats .bili-cover-card__stat:last-child span')
            ?.textContent?.trim()
        return (duration && convertTimeToSec(duration)) ?? undefined
    },
    title: (video: HTMLElement): SelectorResult => {
        return video.querySelector('.bili-video-card__title a')?.textContent?.trim()
    },
    pubdate: (video: HTMLElement): SelectorResult => {
        const text = video
            .querySelector('.bili-video-card__author .bili-video-card__text:nth-child(2)')
            ?.textContent?.trim()
        if (text) {
            const pubdate = text.split(' · ')[1]?.trim()
            if (pubdate) {
                return convertDateToDays(pubdate)
            }
        }
        return undefined
    },
    uploader: (video: HTMLElement): SelectorResult => {
        const text = video
            .querySelector('.bili-video-card__author .bili-video-card__text:nth-child(2)')
            ?.textContent?.trim()
        if (text) {
            return text.split(' · ')[0].trim()
        }
        return undefined
    },
}

class VideoFilterChannel implements IMainFilter {
    target: HTMLElement | undefined

    // 黑名单
    videoDurationFilter = new VideoDurationFilter()
    videoTitleFilter = new VideoTitleFilter()
    videoPubdateFilter = new VideoPubdateFilter()
    videoUploaderFilter = new VideoUploaderFilter()
    videoUploaderKeywordFilter = new VideoUploaderKeywordFilter()

    // 白名单
    videoUploaderWhiteFilter = new VideoUploaderWhiteFilter()

    init() {
        // 黑名单
        this.videoDurationFilter.setParam(GM_getValue(GM_KEYS.black.duration.valueKey, 0))
        this.videoTitleFilter.setParam(GM_getValue(GM_KEYS.black.title.valueKey, []))
        this.videoPubdateFilter.setParam(GM_getValue(GM_KEYS.black.pubdate.valueKey, 0))
        this.videoUploaderFilter.setParam(GM_getValue(GM_KEYS.black.uploader.valueKey, []))
        this.videoUploaderKeywordFilter.setParam(GM_getValue(GM_KEYS.black.uploaderKeyword.valueKey, []))
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
            this.videoPubdateFilter.isEnable
        )) {
            revertAll = true
        }
        const timer = performance.now()

        // 提取元素
        let selector = `.feed-card`
        if (mode === 'incr') {
            selector += `:not([${config.filterVisitSign}])`
        }
        const videos = Array.from(this.target.querySelectorAll<HTMLElement>(selector))
        if (!videos.length) {
            return
        }
        if (revertAll) {
            videos.forEach((v) => showEle(v, 'sign'))
            return
        }

        if (config.isDebugMode) {
            videos.forEach((v) => {
                logger.debug(
                    [
                        `VideoFilterChannel`,
                        `duration: ${selectorFns.duration(v)}`,
                        `title: ${selectorFns.title(v)}`,
                        `uploader: ${selectorFns.uploader(v)}`,
                        `pubdate: ${selectorFns.pubdate(v)}`,
                    ].join('\n'),
                )
            })
        }

        // 构建黑白检测任务
        const blackPairs: SubFilterPair[] = []
        this.videoDurationFilter.isEnable && blackPairs.push([this.videoDurationFilter, selectorFns.duration])
        this.videoTitleFilter.isEnable && blackPairs.push([this.videoTitleFilter, selectorFns.title])
        this.videoPubdateFilter.isEnable && blackPairs.push([this.videoPubdateFilter, selectorFns.pubdate])
        this.videoUploaderFilter.isEnable && blackPairs.push([this.videoUploaderFilter, selectorFns.uploader])
        this.videoUploaderKeywordFilter.isEnable &&
            blackPairs.push([this.videoUploaderKeywordFilter, selectorFns.uploader])

        const whitePairs: SubFilterPair[] = []
        this.videoUploaderWhiteFilter.isEnable && whitePairs.push([this.videoUploaderWhiteFilter, selectorFns.uploader])

        // 检测
        const blackCnt = await coreCheck(videos, true, 'sign', blackPairs, whitePairs)
        const time = (performance.now() - timer).toFixed(1)
        logger.debug(`VideoFilterChannel hide ${blackCnt} in ${videos.length} videos, mode=${mode}, time=${time}`)
    }

    checkFull() {
        this.check('full').catch((err) => {
            logger.error('VideoFilterChannel check full error', err)
        })
    }

    checkIncr() {
        this.check('incr').catch((err) => {
            logger.error('VideoFilterChannel check incr error', err)
        })
    }

    observe() {
        waitForEle(document, '#app', (node: HTMLElement): boolean => {
            return node.id === 'app'
        }).then((ele) => {
            if (!ele) {
                return
            }

            logger.debug('VideoFilterChannel target appear')
            this.target = ele
            this.checkFull()

            new MutationObserver(() => {
                this.checkIncr()
            }).observe(this.target, { childList: true, subtree: true })
        })
    }
}

//==================================================================================================

const mainFilter = new VideoFilterChannel()

export const videoFilterChannelEntry = async () => {
    mainFilter.init()
    mainFilter.observe()
}

export const videoFilterChannelGroups: Group[] = [
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
                step: 1,
                maxValue: 300,
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
export const videoFilterChannelHandler: ContextMenuTargetHandler = (target: HTMLElement): FilterContextMenu[] => {
    if (!isPageChannel()) {
        return []
    }

    const menus: FilterContextMenu[] = []
    // UP主
    if (target.closest('.bili-video-card__author')) {
        const uploader = target
            .closest('.bili-video-card__author')
            ?.querySelector('.bili-video-card__text:last-child')
            ?.textContent?.split(' · ')[0]
            .trim()
        const url = target.closest<HTMLAnchorElement>('.bili-video-card__author')?.href.trim()
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
                            logger.error(`videoFilterChannelHandler add uploader ${uploader} failed`, err)
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
                            logger.error(`videoFilterChannelHandler add uploader keyword failed`, err)
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
                            logger.error(`videoFilterChannelHandler add white uploader ${uploader} failed`, err)
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
                fn: async () => {
                    navigator.clipboard.writeText(`https://${spaceUrl}`).catch(() => {})
                },
            })
        }
    }
    // 标题 / BVID
    if (target.closest('.bili-video-card__title')) {
        const titleEl = target.closest('.bili-video-card__title')
        const title =
            titleEl?.querySelector('a')?.getAttribute('title')?.trim() ||
            titleEl?.querySelector('a')?.textContent?.trim() ||
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
                        logger.error(`videoFilterChannelHandler add title keyword failed`, err)
                    }
                },
            })
        }
    }
    return menus
}
