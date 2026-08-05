import { defineStore } from 'pinia'
import { ref } from 'vue'

export type KeywordInputOptions = {
    title: string
    description?: string
    initialValue: string
}

const DEFAULT_DESCRIPTION = '删除多余文字，只保留需要屏蔽的关键词。多个关键词可用 | 分隔，例如：关键词A|关键词B'

/** 按 | 拆成多个关键词，去掉首尾空白与空段 */
export const splitKeywords = (raw: string): string[] => {
    return raw
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean)
}

/**
 * 右键快捷录入关键词：预填原文，二次编辑后确认写入黑名单
 */
export const useKeywordInputStore = defineStore('KeywordInput', () => {
    const isShow = ref(false)
    const title = ref('')
    const description = ref('')
    const value = ref('')

    let resolveFn: ((result: string[] | null) => void) | null = null

    const open = (options: KeywordInputOptions): Promise<string[] | null> => {
        // 若已有未完成的录入，先取消
        resolveFn?.(null)
        title.value = options.title
        description.value = options.description ?? DEFAULT_DESCRIPTION
        value.value = options.initialValue
        isShow.value = true
        return new Promise((resolve) => {
            resolveFn = resolve
        })
    }

    const confirm = () => {
        const keywords = splitKeywords(value.value)
        isShow.value = false
        resolveFn?.(keywords.length ? keywords : null)
        resolveFn = null
    }

    const cancel = () => {
        isShow.value = false
        resolveFn?.(null)
        resolveFn = null
    }

    return { isShow, title, description, value, open, confirm, cancel }
})
