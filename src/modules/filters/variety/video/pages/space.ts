import { coreCheck } from '@/modules/filters/core/core'
import config from '@/config'
import { Group } from '@/types/collection'
import { ContextMenuTargetHandler, FilterContextMenu, IMainFilter, SelectorResult, SubFilterPair } from '@/types/filter'
import { logger } from '@/utils/logger'
import { isPageSpace } from '@/utils/pageType'
import { GM_getValue, GM_setValue } from '$'
import { promptKeyword } from '@/utils/keywordPrompt'
import { convertTimeToSec, orderedUniq, showEle, waitForEle } from '@/utils/tool'
import { VideoDurationFilter, VideoTitleFilter } from '../subFilters/black'

const GM_KEYS = {
    black: {
        duration: {
            statusKey: 'global-duration-filter-status',
            valueKey: 'global-duration-filter-value',
        },
        title: {
            statusKey: 'global-title-keyword-filter-status',
            valueKey: 'global-title-keyword-filter-value',
        },
    },
}

// 视频列表信息提取
const selectorFns = {
    duration: (video: HTMLElement): SelectorResult => {
        const duration =
            video.querySelector('span.length')?.textContent?.trim() ||
            video.querySelector('.bili-cover-card__stats .bili-cover-card__stat:nth-last-child(1)')?.textContent?.trim()
        return (duration && convertTimeToSec(duration)) ?? undefined
    },
    title: (video: HTMLElement): SelectorResult => {
        return (
            video.querySelector('a.title')?.textContent?.trim() ||
            video.querySelector('.bili-video-card__title a')?.textContent?.trim()
        )
    },
}

class VideoFilterSpace implements IMainFilter {
    target: HTMLElement | undefined

    // 黑名单
    videoDurationFilter = new VideoDurationFilter()
    videoTitleFilter = new VideoTitleFilter()

    init() {
        // 黑名单
        this.videoDurationFilter.setParam(GM_getValue(GM_KEYS.black.duration.valueKey, 0))
        this.videoTitleFilter.setParam(GM_getValue(GM_KEYS.black.title.valueKey, []))
    }

    async check(mode?: 'full' | 'incr') {
        if (!this.target) {
            return
        }
        let revertAll = false
        if (!(this.videoDurationFilter.isEnable || this.videoTitleFilter.isEnable)) {
            revertAll = true
        }
        const timer = performance.now()

        // 提取元素
        let selector
        // 主页视频
        if (/^\/\d+$/.test(location.pathname)) {
            selector = `#page-index .small-item, .section-wrap.video-section .items__item, .section-wrap.lists-section .video-list__item`
        }
        // 投稿视频
        if (/^\/\d+\/(?:upload\/)?video$/.test(location.pathname)) {
            selector = `#submit-video :is(.small-item,.list-item), .video-list .upload-video-card`
        }
        // 旧版空间页 视频合集、视频系列
        if (/^\/\d+\/channel\/(collectiondetail|seriesdetail)/.test(location.pathname)) {
            selector = `:is(#page-collection-detail,#page-series-detail) li.small-item`
        }
        // 新版空间页 视频合集内视频
        if (/^\/\d+\/lists/.test(location.pathname)) {
            selector = `.space-lists .video-list .video-list__item, .space-list-details .list-video-item`
        }
        if (!selector) {
            return
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
                    [`VideoFilterSpace`, `duration: ${selectorFns.duration(v)}`, `title: ${selectorFns.title(v)}`].join(
                        '\n',
                    ),
                )
            })
        }

        // 构建黑白检测任务
        const blackPairs: SubFilterPair[] = []
        this.videoDurationFilter.isEnable && blackPairs.push([this.videoDurationFilter, selectorFns.duration])
        this.videoTitleFilter.isEnable && blackPairs.push([this.videoTitleFilter, selectorFns.title])

        // 检测
        const blackCnt = await coreCheck(videos, true, 'sign', blackPairs)
        const time = (performance.now() - timer).toFixed(1)
        logger.debug(`VideoFilterSpace hide ${blackCnt} in ${videos.length} videos, mode=${mode}, time=${time}`)
    }

    checkFull() {
        this.check('full').catch((err) => {
            logger.error('VideoFilterSpace check full error', err)
        })
    }

    // checkIncr() {
    //     this.check('incr')
    //         .catch((err) => {
    //             logger.error('VideoFilterSpace check incr error', err)
    //         })
    // }

    observe() {
        waitForEle(document, '#app', (node: HTMLElement): boolean => {
            return node.id === 'app'
        }).then((ele) => {
            if (!ele) {
                return
            }

            logger.debug('VideoFilterSpace target appear')
            this.target = ele
            this.checkFull()

            new MutationObserver(() => {
                this.checkFull() // 空间页始终全量check
            }).observe(this.target, { childList: true, subtree: true })
        })
    }
}

//==================================================================================================

const mainFilter = new VideoFilterSpace()

export const videoFilterSpaceEntry = async () => {
    mainFilter.init()
    mainFilter.observe()
}

export const videoFilterSpaceGroups: Group[] = [
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
]

// 右键菜单handler
export const videoFilterSpaceHandler: ContextMenuTargetHandler = (target: HTMLElement): FilterContextMenu[] => {
    if (!isPageSpace()) {
        return []
    }

    const menus: FilterContextMenu[] = []
    // 标题 / BVID
    if (target.closest('.bili-video-card__title')) {
        const titleEl = target.closest('.bili-video-card__title')
        const title =
            titleEl?.querySelector('a')?.getAttribute('title')?.trim() ||
            (target as HTMLAnchorElement).title?.trim() ||
            titleEl?.textContent?.trim() ||
            target.textContent?.trim()
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
                        logger.error(`videoFilterSpaceHandler add title keyword failed`, err)
                    }
                },
            })
        }
    }
    return menus
}
