/** 解析视频卡片显示的播放量，无法识别时不参与过滤 */
export const parseVideoViews = (text?: string): number | undefined => {
    const normalized = text?.replaceAll(',', '').replace(/\s+/g, '')
    const match = normalized?.match(/(\d+(?:\.\d+)?)(万|亿)?(?:次?播放)?/)
    if (!match) {
        return undefined
    }
    const multiplier = match[2] === '亿' ? 100000000 : match[2] === '万' ? 10000 : 1
    return Number(match[1]) * multiplier
}
