import { Item } from '@/types/item'
import { startHideExtraTabs, stopHideExtraTabs } from '../extraTabs'

export const popularOtherItems: Item[] = [
    {
        type: 'switch',
        id: 'popular-hide-extra-tabs',
        name: '隐藏 每周必看/入站必刷/全站音乐榜/手游热榜 Tab',
        description: ['排行榜 下同步隐藏：番剧、国创、纪录片、电影、电视剧、综艺、动画、音乐、时尚美妆、体育运动'],
        enableFn: startHideExtraTabs,
        disableFn: stopHideExtraTabs,
    },
    {
        type: 'switch',
        id: 'popular-hot-hide-tag',
        name: '隐藏 综合热门 视频tag',
    },
    {
        type: 'switch',
        id: 'popular-weekly-hide-hint',
        name: '隐藏 每周必看 一句话简介',
    },
    {
        type: 'switch',
        id: 'popular-history-hide-hint',
        name: '隐藏 入站必刷 一句话简介',
    },
]
