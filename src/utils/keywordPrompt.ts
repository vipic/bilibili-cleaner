import { KeywordInputOptions, useKeywordInputStore } from '@/stores/keywordInput'

/** 打开关键词二次编辑弹窗，取消或空内容时返回 null */
export const promptKeyword = (options: KeywordInputOptions): Promise<string | null> => {
    return useKeywordInputStore().open(options)
}
