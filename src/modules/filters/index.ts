import config from '@/config'
import { Filter } from '@/types/collection'
import {
    isPageBangumi,
    isPageChannel,
    isPageDynamic,
    isPageFestival,
    isPageHomepage,
    isPageLive,
    isPagePlaylist,
    isPagePopular,
    isPageSearch,
    isPageSpace,
    isPageVideo,
} from '@/utils/pageType'
import {
    commentFilterCommonEntry,
    commentFilterCommonGroups,
    commentFilterCommonHandler,
} from './variety/comment/pages/common'
import {
    dynamicFilterDynamicEntry,
    dynamicFilterDynamicGroups,
    dynamicFilterDynamicHandler,
} from './variety/dynamic/pages/dynamic'
import { dynamicFilterHeaderEntry } from './variety/dynamic/pages/header'
import { dynamicFilterSpaceEntry, dynamicFilterSpaceGroups } from './variety/dynamic/pages/space'
import {
    videoFilterChannelEntry,
    videoFilterChannelGroups,
    videoFilterChannelHandler,
} from './variety/video/pages/channel'
import {
    videoFilterHomepageEntry,
    videoFilterHomepageGroups,
    videoFilterHomepageHandler,
} from './variety/video/pages/homepage'
import {
    videoFilterPopularEntry,
    videoFilterPopularGroups,
    videoFilterPopularHandler,
} from './variety/video/pages/popular'
import { videoFilterSearchEntry, videoFilterSearchGroups, videoFilterSearchHandler } from './variety/video/pages/search'
import { videoFilterSpaceEntry, videoFilterSpaceGroups, videoFilterSpaceHandler } from './variety/video/pages/space'
import { videoFilterVideoEntry, videoFilterVideoGroups, videoFilterVideoHandler } from './variety/video/pages/video'
import { articleFilterEntry, articleFilterGroups, articleFilterHandler } from './variety/article'

/** 视频过滤器 */
export const videoFilters: Filter[] = [
    {
        name: '首页 视频过滤',
        groups: videoFilterHomepageGroups,
        entry: videoFilterHomepageEntry,
        checkFn: isPageHomepage,
    },
    {
        name: '播放页 视频过滤',
        groups: videoFilterVideoGroups,
        entry: videoFilterVideoEntry,
        checkFn: () => isPageVideo() || isPagePlaylist(),
    },
    {
        name: '热门页 视频过滤',
        groups: videoFilterPopularGroups,
        entry: videoFilterPopularEntry,
        checkFn: isPagePopular,
    },
    {
        name: '新版分区页 视频过滤',
        groups: videoFilterChannelGroups,
        entry: videoFilterChannelEntry,
        checkFn: isPageChannel,
    },
    {
        name: '搜索页 视频过滤',
        groups: videoFilterSearchGroups,
        entry: videoFilterSearchEntry,
        checkFn: isPageSearch,
    },
    {
        name: '空间页 视频过滤',
        groups: videoFilterSpaceGroups,
        entry: videoFilterSpaceEntry,
        checkFn: isPageSpace,
    },
]

/** 评论过滤器 */
export const commentFilters: Filter[] = [
    {
        name: '视频页/番剧页/动态页/空间页 视频评论过滤',
        groups: commentFilterCommonGroups,
        entry: commentFilterCommonEntry,
        checkFn: () =>
            isPageVideo() ||
            isPageBangumi() ||
            isPagePlaylist() ||
            isPageDynamic() ||
            isPageSpace() ||
            isPageFestival(),
    },
]

/** 动态过滤器 */
export const dynamicFilters: Filter[] = [
    {
        name: '动态页 动态过滤',
        groups: dynamicFilterDynamicGroups,
        entry: dynamicFilterDynamicEntry,
        checkFn: isPageDynamic,
    },
    {
        name: '空间页 动态过滤',
        groups: dynamicFilterSpaceGroups,
        entry: dynamicFilterSpaceEntry,
        checkFn: isPageSpace,
    },
    {
        name: '顶栏 动态过滤',
        groups: [],
        entry: dynamicFilterHeaderEntry,
        checkFn: () => !isPageLive(),
    },
]

/** 专栏过滤器 */
export const articleFilters: Filter[] = [
    {
        name: '搜索页 专栏过滤',
        groups: articleFilterGroups,
        entry: articleFilterEntry,
        checkFn: isPageSearch,
    },
]

/** 载入过滤器样式 */
export const loadFilterStyle = () => {
    const style = document.createElement('style')
    style.className = `bili-cleaner-css filter`
    style.textContent = `:is(body, #app, #i_cecream) [${config.filterHideSign}] {display: none !important;}
.bili-cleaner-partition-tag {
    display: block;
    width: fit-content;
    margin: 3px 0;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 11px;
    line-height: 16px;
    color: #ea580c;
    border: 1px solid #f97316;
    user-select: none;
}
/* 首页：标签在昵称行内，改为行内并增加与前后元素的间距 */
.bili-video-card__info--owner .bili-cleaner-partition-tag {
    display: inline-block;
    width: auto;
    margin: 0 6px 0 8px;
}
/* 分区标签存在时，热门页/播放页 昵称与播放量上下排列 */
.bili-cleaner-partition-tag ~ .up-name,
.bili-cleaner-partition-tag ~ .video-stat,
.bili-cleaner-partition-tag ~ .upname,
.bili-cleaner-partition-tag ~ .play {
    display: block;
}`
    document.documentElement?.appendChild(style)
}

/** 右键菜单功能 */
export const filterContextMenuHandlers = [
    videoFilterVideoHandler,
    videoFilterSearchHandler,
    videoFilterChannelHandler,
    videoFilterPopularHandler,
    videoFilterHomepageHandler,
    videoFilterSpaceHandler,
    dynamicFilterDynamicHandler,
    commentFilterCommonHandler,
    articleFilterHandler,
]
