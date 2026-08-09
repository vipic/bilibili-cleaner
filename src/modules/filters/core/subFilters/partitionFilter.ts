import { ISubFilter, SelectorFn } from '@/types/filter'

/**
 * 投稿分区过滤器（黑名单）
 * 黑名单每行一个分区，与视频数据中的 tid 精确匹配
 * 存储格式支持 "124"、"124|社科·法律·心理"、"124 社科·法律·心理"，仅取行首分区ID
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

    /** 提取行首分区ID，非数字开头的行返回空串 */
    private static parseId(value: string): string {
        return value.trim().match(/^\d+/)?.[0] ?? ''
    }

    addParam(value: string): void {
        const id = PartitionFilter.parseId(value)
        if (id) {
            this.idSet.add(id)
        }
    }

    setParam(value: string[]): void {
        this.idSet = new Set(value.map(PartitionFilter.parseId).filter(Boolean))
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
