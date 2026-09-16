import { GM_getValue, GM_setValue } from '$'

const legacyStatusKeys: Record<string, string[]> = {
    'global-duration-filter-status': [
        'homepage-duration-filter-status',
        'popular-duration-filter-status',
        'search-duration-filter-status',
        'channel-duration-filter-status',
        'space-duration-filter-status',
        'video-duration-filter-status',
    ],
    'global-views-filter-status': [
        'homepage-views-filter-status',
        'popular-views-filter-status',
        'search-views-filter-status',
    ],
    'global-uploader-filter-status': [
        'homepage-uploader-filter-status',
        'popular-uploader-filter-status',
        'search-uploader-filter-status',
        'channel-uploader-filter-status',
        'video-uploader-filter-status',
    ],
    'global-uploader-keyword-filter-status': [
        'homepage-uploader-keyword-filter-status',
        'popular-uploader-keyword-filter-status',
        'search-uploader-keyword-filter-status',
        'channel-uploader-keyword-filter-status',
        'video-uploader-keyword-filter-status',
    ],
    'global-title-keyword-filter-status': [
        'homepage-title-keyword-filter-status',
        'popular-title-keyword-filter-status',
        'search-title-keyword-filter-status',
        'channel-title-keyword-filter-status',
        'space-title-keyword-filter-status',
        'video-title-keyword-filter-status',
    ],
    'global-pubdate-filter-status': ['homepage-pubdate-filter-status', 'channel-pubdate-filter-status'],
    'global-partition-filter-status': [
        'homepage-partition-filter-status',
        'popular-partition-filter-status',
        'search-partition-filter-status',
        'video-partition-filter-status',
    ],
    'global-partition-tag-status': [
        'homepage-partition-tag-status',
        'popular-partition-tag-status',
        'search-partition-tag-status',
        'video-partition-tag-status',
    ],
    'global-uploader-whitelist-filter-status': [
        'homepage-uploader-whitelist-filter-status',
        'popular-uploader-whitelist-filter-status',
        'search-uploader-whitelist-filter-status',
        'channel-uploader-whitelist-filter-status',
        'video-uploader-whitelist-filter-status',
    ],
}

export const migrateVideoFilterSettings = () => {
    for (const [globalKey, legacyKeys] of Object.entries(legacyStatusKeys)) {
        if (GM_getValue<boolean | undefined>(globalKey, undefined) !== undefined) {
            continue
        }
        const legacyValues = legacyKeys
            .map((key) => GM_getValue<boolean | undefined>(key, undefined))
            .filter((value): value is boolean => value !== undefined)
        if (legacyValues.length) {
            GM_setValue(globalKey, legacyValues.some(Boolean))
        }
    }
}
