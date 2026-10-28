/** 热门页顶部需要隐藏的 Tab 名称 */
const hiddenNavTabNames = new Set(['每周必看', '入站必刷', '全站音乐榜', '手游热榜'])

/** 排行榜内需要隐藏的分类 Tab 名称 */
const hiddenRankTabNames = new Set([
    '番剧',
    '国创',
    '纪录片',
    '电影',
    '电视剧',
    '综艺',
    '动画',
    '音乐',
    '时尚美妆',
    '体育运动',
    '动物',
    '汽车',
    '美食',
    '鬼畜',
    '舞蹈',
])

/** 隐藏 Tab 时添加的 class，供样式表匹配 */
const hideTabClassName = 'bili-cleaner-hide-tab'

let observer: MutationObserver | undefined

const markTabs = (selector: string, names: Set<string>) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((tab) => {
        const name = tab.textContent?.trim()
        if (name && names.has(name)) {
            tab.classList.add(hideTabClassName)
        }
    })
}

const markExtraTabs = () => {
    markTabs('.nav-tabs .nav-tabs__item', hiddenNavTabNames)
    markTabs('.rank-tab-wrap .rank-tab > li', hiddenRankTabNames)
}

/** 新增节点中是否可能包含目标 Tab */
const maybeContainsTabs = (node: Node): boolean => {
    if (!(node instanceof HTMLElement)) {
        return false
    }
    return (
        node.matches('.nav-tabs, .nav-tabs__item, .rank-tab, .rank-tab > li') ||
        !!node.querySelector('.nav-tabs__item, .rank-tab > li')
    )
}

/** 启用：标记需隐藏的 Tab，并监听后续渲染（排行榜分类 Tab 在进入排行榜后才挂载） */
export const startHideExtraTabs = () => {
    markExtraTabs()
    observer?.disconnect()
    observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => Array.from(mutation.addedNodes).some(maybeContainsTabs))) {
            markExtraTabs()
        }
    })
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true })
}

/** 禁用：停止监听并清除标记 */
export const stopHideExtraTabs = () => {
    observer?.disconnect()
    observer = undefined
    document
        .querySelectorAll<HTMLElement>(`.nav-tabs__item.${hideTabClassName}, .rank-tab > li.${hideTabClassName}`)
        .forEach((tab) => {
            tab.classList.remove(hideTabClassName)
        })
}
