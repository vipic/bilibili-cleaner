import { ISubFilter, SelectorFn } from '@/types/filter'

/**
 * 投稿分区过滤器（黑名单）
 * 黑名单每行一个分区ID，与视频数据中的 tid 精确匹配
 *
 * selectorFn 返回格式: `${tid}|${tname}`，如 `124|社科·法律·心理`
 */
export class PartitionFilter implements ISubFilter {
    isEnable = false
    private idSet = new Set<string>()

    enable(): void {
        this.isEnable = true
    }

    disable(): void {
        this.isEnable = false
    }

    addParam(value: string): void {
        value = value.trim()
        if (/^\d+$/.test(value)) {
            this.idSet.add(value)
        }
    }

    setParam(value: string[]): void {
        this.idSet = new Set(value.map((v) => v.trim()).filter((v) => /^\d+$/.test(v)))
    }

    check(el: HTMLElement, selectorFn: SelectorFn): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.isEnable) {
                const value = selectorFn(el)
                if (typeof value === 'string') {
                    const sepIdx = value.indexOf('|')
                    const tid = sepIdx >= 0 ? value.slice(0, sepIdx).trim() : value.trim()
                    if (tid && this.idSet.has(tid)) {
                        reject()
                        return
                    }
                }
            }
            resolve()
        })
    }
}
