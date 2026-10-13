import { describe, expect, it, vi } from 'vitest'

// 只替代浏览器持久化/页面环境，过滤器与归一化函数使用生产实现。
vi.mock('vite-plugin-monkey/dist/client', () => ({ GM_getValue: () => false, unsafeWindow: {} }))

import { KeywordFilter } from '../src/modules/filters/core/subFilters/keywordFilter'
import { NumberMinFilter } from '../src/modules/filters/core/subFilters/numberMinFilter'
import { NumberMaxFilter } from '../src/modules/filters/core/subFilters/numberMaxFilter'
import { StringFilter } from '../src/modules/filters/core/subFilters/stringFilter'

const element = {} as HTMLElement
const check = (filter: KeywordFilter | NumberMinFilter | NumberMaxFilter | StringFilter, value: string | number) =>
    filter.check(element, () => value)

async function blocked(promise: Promise<void>) {
    // 原接口以 reject(undefined) 表示拦截，不能只断言 falsy。
    const outcome = await promise.then(() => 'allowed', () => 'blocked')
    expect(outcome).toBe('blocked')
}

describe('关键词过滤的绕过与正则边界', () => {
    it('归一化全角、Unicode/零宽空白，禁用后不拦截', async () => {
        const filter = new KeywordFilter()
        filter.setParam(['ABC', '广告'])
        filter.enable()
        for (const value of ['ＡＢＣ', 'a\u200bb\u2060c', '广\u00a0\u3000告']) await blocked(check(filter, value))
        await expect(check(filter, '正常内容')).resolves.toBeUndefined()
        filter.disable()
        await expect(check(filter, '广告')).resolves.toBeUndefined()
    })

    it('普通关键词转义元字符，非法正则不破坏其他规则，反向引用不串组', async () => {
        const filter = new KeywordFilter()
        filter.setParam(['a.b', '/[/', '/(哈)\\1/', '/(嘻)\\1/'])
        filter.enable()
        for (const value of ['a.b', '哈哈', '嘻嘻']) await blocked(check(filter, value))
        for (const value of ['axb', '哈嘻', '普通']) await expect(check(filter, value)).resolves.toBeUndefined()
        filter.setParam(['新词'])
        await expect(check(filter, 'a.b')).resolves.toBeUndefined()
        await blocked(check(filter, '新词'))
    })
})

it('数值过滤严格比较上下界，等于门槛保留，禁用不拦截', async () => {
    for (const [Filter, rejected, accepted] of [[NumberMinFilter, 9, 11], [NumberMaxFilter, 11, 9]] as const) {
        const filter = new Filter()
        filter.setParam(10)
        filter.enable()
        await blocked(check(filter, rejected))
        for (const value of [10, accepted, '9']) await expect(check(filter, value)).resolves.toBeUndefined()
        filter.disable()
        await expect(check(filter, rejected)).resolves.toBeUndefined()
    }
})

it('精确名单去除首尾空白但不做子串匹配，替换列表移除旧条目', async () => {
    const filter = new StringFilter()
    filter.setParam([' 用户 ', '', '用户'])
    filter.enable()
    await blocked(check(filter, ' 用户 '))
    await expect(check(filter, '用户甲')).resolves.toBeUndefined()
    filter.setParam(['新人'])
    await expect(check(filter, '用户')).resolves.toBeUndefined()
    await blocked(check(filter, '新人'))
})
