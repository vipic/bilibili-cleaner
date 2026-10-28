/** 热门页顶部需要隐藏的 Tab 名称 */
const hiddenNavTabNames = new Set(['每周必看', '入站必刷', '全站音乐榜', '手游热榜', '排行榜'])

/** 排行榜全部分类（名称 → 路由） */
const allRankTabs = [
    { name: '全部', slug: 'all' },
    { name: '番剧', slug: 'anime' },
    { name: '国创', slug: 'guochuang' },
    { name: '纪录片', slug: 'documentary' },
    { name: '电影', slug: 'movie' },
    { name: '电视剧', slug: 'tv' },
    { name: '综艺', slug: 'variety' },
    { name: '动画', slug: 'douga' },
    { name: '游戏', slug: 'game' },
    { name: '鬼畜', slug: 'kichiku' },
    { name: '音乐', slug: 'music' },
    { name: '舞蹈', slug: 'dance' },
    { name: '影视', slug: 'cinephile' },
    { name: '娱乐', slug: 'ent' },
    { name: '知识', slug: 'knowledge' },
    { name: '科技数码', slug: 'tech' },
    { name: '美食', slug: 'food' },
    { name: '汽车', slug: 'car' },
    { name: '时尚美妆', slug: 'fashion' },
    { name: '体育运动', slug: 'sports' },
    { name: '动物', slug: 'animal' },
]

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

/** 未隐藏的排行榜分类提升为一级 Tab */
export const promotedRankTabs = allRankTabs.filter((tab) => !hiddenRankTabNames.has(tab.name))

/** 隐藏 Tab 时添加的属性，供样式表匹配（Vue 重写 class 时不会覆盖属性） */
const hideTabAttr = 'bili-cleaner-hide-tab'
/** 置顶插入的一级 Tab class */
const promotedTabClassName = 'bili-cleaner-promoted-tab'
/** 分类 Tab 置顶完成后加到 html，样式表据此隐藏原分类行 */
const readyClassName = 'bili-cleaner-rank-nav-ready'

let observer: MutationObserver | undefined
let removeAfterEach: (() => void) | undefined
let boundRouter: any
const promotedItems: HTMLElement[] = []

const markTabs = (selector: string, names: Set<string>) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((tab) => {
        const name = tab.textContent?.trim()
        if (name && names.has(name)) {
            tab.setAttribute(hideTabAttr, '')
        }
    })
}

/** 获取热门页 vue-router 实例 */
const getRouter = (): any =>
    (document.querySelector('.nav-tabs') as any)?.__vue__?.$router ??
    (document.querySelector('#app') as any)?.__vue__?.$router

/** 当前排行榜分类，非排行榜页返回空字符串 */
const getActiveRankSlug = (): string => {
    const matched = location.pathname.match(/^\/v\/popular\/rank\/([^/]+)\/?$/)
    return matched?.[1] ?? (location.pathname === '/v/popular/rank' ? 'all' : '')
}

const updatePromotedActive = () => {
    const activeSlug = getActiveRankSlug()
    for (const tab of promotedItems) {
        tab.classList.toggle('nav-tabs__item--active', !!activeSlug && tab.dataset.slug === activeSlug)
    }
}

const createPromotedTab = (name: string, slug: string): HTMLElement => {
    const tab = document.createElement('div')
    tab.className = `nav-tabs__item ${promotedTabClassName}`
    tab.dataset.slug = slug

    const inner = document.createElement('div')
    const text = document.createElement('span')
    text.textContent = name
    inner.appendChild(text)
    tab.appendChild(inner)

    tab.addEventListener('click', () => {
        const path = `/v/popular/rank/${slug}`
        bindRouterHook()
        const router = getRouter()
        if (!router) {
            location.href = path
            return
        }
        try {
            const result = router.push(path)
            if (result && typeof result.catch === 'function') {
                result.catch(() => {})
            }
        } catch {
            location.href = path
        }
    })

    return tab
}

/** 路由变化时同步置顶 Tab 高亮 */
const bindRouterHook = () => {
    const router = getRouter()
    if (!router || router === boundRouter) {
        return
    }
    removeAfterEach?.()
    removeAfterEach = router.afterEach(() => updatePromotedActive())
    boundRouter = router
}

/** 把保留的排行榜分类插入一级 Tab 行 */
const mountPromotedTabs = () => {
    const nav = document.querySelector<HTMLElement>('.nav-tabs')
    if (!nav) {
        return
    }
    if (!promotedItems.length || promotedItems.some((tab) => !tab.isConnected)) {
        promotedItems.forEach((tab) => tab.remove())
        promotedItems.length = 0
        for (const { name, slug } of promotedRankTabs) {
            const tab = createPromotedTab(name, slug)
            nav.appendChild(tab)
            promotedItems.push(tab)
        }
    }
    document.documentElement.classList.add(readyClassName)
    updatePromotedActive()
    bindRouterHook()
}

const unmountPromotedTabs = () => {
    promotedItems.forEach((tab) => tab.remove())
    promotedItems.length = 0
    document.documentElement.classList.remove(readyClassName)
    removeAfterEach?.()
    removeAfterEach = undefined
    boundRouter = undefined
}

const markExtraTabs = () => {
    markTabs('.nav-tabs .nav-tabs__item', hiddenNavTabNames)
    markTabs('.rank-tab-wrap .rank-tab > li', hiddenRankTabNames)
    mountPromotedTabs()
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

/** 启用：标记需隐藏的 Tab，并把排行榜分类提升为一级 Tab */
export const startHideExtraTabs = () => {
    markExtraTabs()
    observer?.disconnect()
    observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => Array.from(mutation.addedNodes).some(maybeContainsTabs))) {
            markExtraTabs()
        }
    })
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true })
    window.addEventListener('popstate', updatePromotedActive)
}

/** 禁用：停止监听，移除置顶 Tab 并清除标记 */
export const stopHideExtraTabs = () => {
    observer?.disconnect()
    observer = undefined
    window.removeEventListener('popstate', updatePromotedActive)
    unmountPromotedTabs()
    document
        .querySelectorAll<HTMLElement>(`.nav-tabs__item[${hideTabAttr}], .rank-tab > li[${hideTabAttr}]`)
        .forEach((tab) => {
            tab.removeAttribute(hideTabAttr)
        })
}
