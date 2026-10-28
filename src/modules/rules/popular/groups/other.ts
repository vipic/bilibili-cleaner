import { Item } from '@/types/item'
import { promotedRankTabs, startHideExtraTabs, stopHideExtraTabs } from '../extraTabs'

export const popularOtherItems: Item[] = [
    {
        type: 'switch',
        id: 'popular-hide-extra-tabs',
        name: '隐藏 多余 Tab (排行榜分类置顶)',
        description: [
            '顶部隐藏 每周必看、入站必刷、全站音乐榜、手游热榜、排行榜',
            `排行榜分类置顶为一级 Tab：${promotedRankTabs.map((tab) => tab.name).join('、')}`,
        ],
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
