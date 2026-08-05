<template>
    <div
        v-if="store.isShow"
        class="fixed inset-0 z-10000001 flex items-center justify-center bg-black/30"
        @mousedown.self="store.cancel()"
    >
        <div
            class="w-[min(92vw,420px)] overflow-hidden rounded-xl bg-white shadow-lg shadow-black/20"
            @keydown.esc.stop.prevent="store.cancel()"
            @keydown.enter.stop.prevent="store.confirm()"
        >
            <div class="bg-[#00AEEC] py-2 text-center text-lg font-black text-white">
                {{ store.title }}
            </div>
            <div class="space-y-3 p-4 text-[15px] text-black">
                <p v-if="store.description" class="text-sm leading-relaxed text-gray-500">
                    {{ store.description }}
                </p>
                <input
                    ref="inputRef"
                    v-model="store.value"
                    type="text"
                    @keydown.stop
                    @keydown.enter.stop.prevent="store.confirm()"
                    @keydown.esc.stop.prevent="store.cancel()"
                    class="block w-full rounded-md border-2 border-gray-300 bg-white px-3 py-2 outline-hidden focus:border-[#00AEEC]"
                    spellcheck="false"
                    placeholder="输入关键词，多个用 | 分隔"
                />
                <div class="flex justify-end gap-2">
                    <button
                        type="button"
                        class="cursor-pointer rounded-md px-4 py-1.5 text-gray-600 hover:bg-gray-100"
                        @click="store.cancel()"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        class="cursor-pointer rounded-md bg-[#00AEEC] px-4 py-1.5 text-white hover:bg-[#00AEEC]/90"
                        @click="store.confirm()"
                    >
                        确定
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useKeywordInputStore } from '@/stores/keywordInput'
import { nextTick, ref, watch } from 'vue'

const store = useKeywordInputStore()
const inputRef = ref<HTMLInputElement | null>(null)

watch(
    () => store.isShow,
    async (show) => {
        if (!show) {
            return
        }
        await nextTick()
        inputRef.value?.focus()
        inputRef.value?.select()
    },
)
</script>
