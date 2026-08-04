<template>
    <div class="text-base">
        <RulePanelView></RulePanelView>
        <VideoFilterPanelView></VideoFilterPanelView>
        <CommentFilterPanelView></CommentFilterPanelView>
        <DynamicFilterPanelView></DynamicFilterPanelView>
        <ContextMenuView></ContextMenuView>
        <KeywordInputDialog></KeywordInputDialog>
        <SideBtnView></SideBtnView>
        <ArticleFilterPanelView></ArticleFilterPanelView>
    </div>
</template>
<script setup lang="ts">
import KeywordInputDialog from './components/KeywordInputDialog.vue'
import CommentFilterPanelView from './views/CommentFilterPanelView.vue'
import ContextMenuView from './views/ContextMenuView.vue'
import DynamicFilterPanelView from './views/DynamicFilterPanelView.vue'
import RulePanelView from './views/RulePanelView.vue'
import ArticleFilterPanelView from './views/ArticleFilterPanelView.vue'
import SideBtnView from './views/SideBtnView.vue'
import VideoFilterPanelView from './views/VideoFilterPanelView.vue'
</script>
