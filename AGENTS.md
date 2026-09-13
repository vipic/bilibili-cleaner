# bilibili-cleaner — Agent 指南

> Bilibili 页面净化用户脚本；Vue 3 + Vite + TypeScript + pnpm。该仓库是上游 fork，保持改动小而可合并。

## 项目约定

- 安装依赖和构建沿用仓库锁定的 pnpm，不替换 Vue/Vite/vite-plugin-monkey 发布链路。
- 标准验证命令是 `pnpm build`，同时执行 `vue-tsc -b` 与 Vite 构建。
- 用户脚本元数据维护在 `vite.config.ts`；当前可见版本取 `userscript.version`，不是 `package.json` 中的占位版本。
- 用户可见改动按语义版本规则同步更新 `userscript.version`；纯文档与 Agent 规则调整不升版本。
- 不扩大 userscript 的 `match`、远程资源或页面权限范围，除非用户明确要求并完成安全审查。
- 页面结构依赖 Bilibili DOM，选择器和挂载逻辑改动应局部化，避免为了本地定制做大规模架构调整。

<!-- workspace-policy:start hash=b4156f5636d7 -->
## 跨项目统一规则

以下区块由私有 `workspace-meta` 生成；项目专属规则请写在区块外。

### 协作

- [LANG-001] 文档、提交标题和用户可见文案默认使用中文。

### Git

- [GIT-001] 提交使用 Conventional Commits，格式为 `<type>(<optional-scope>): <中文说明>`，标题不以句号结尾。
- [GIT-002] 未明确要求时不要自动提交；需要提交时先检查 status、diff 和近期提交风格。
- [GIT-003] 禁止使用 `--no-verify`，不得擅自 amend，也不得添加 Co-Authored-By 或其他 AI/工具署名 trailer。

### 安全

- [SAFE-001] 保留用户已有和无关改动，不做顺手重构，不使用破坏性 Git 或文件操作。
- [SAFE-002] 不得提交 `.env`、密钥、个人数据、日志、报告、缓存或构建产物。

### 验证

- [VERIFY-001] 修改后运行仓库声明的统一验证入口；涉及页面流程时按需补做人工或视觉验收。
- [TEST-001] 测试按风险添加，优先覆盖非平凡逻辑、稳定契约、安全边界和缺陷回归；静态配置与简单透传通常使用语法检查、构建或验收验证，不因每次改动机械新增测试。
- [TEST-002] 不为 UI 展现层编写单元测试或快照测试；界面外观与页面交互通过视觉或人工验收覆盖，可脱离 UI 的业务逻辑仍按风险编写单元测试。
- [TEST-003] 不编写或维护 E2E 测试；端到端页面流程按需通过人工验收覆盖。

### 依赖

- [DEPS-001] 改动保持最小，不引入项目基线之外的新框架、构建工具或生产依赖，除非用户明确要求。

### 文档

- [DOCS-001] 行为、命令或部署方式变化时同步 README 和相关文档，不保留过期引用。
- [DOCS-002] 跨仓依赖只记录本仓消费的稳定接口契约与验证方式；提供方的配置项、内部结构和操作步骤由其所属仓库维护，不在消费方重复复制。

### 版本

- [VERSION-001] 用户可见改动必须在同一提交中更新用户可见版本：feat 升 MINOR，fix/style 升 PATCH，breaking 升 MAJOR。

### 用户脚本

- [USERSCRIPT-001] 用户可见改动同步更新 userscript 版本，并继续使用上游既有构建与发布链路。

### 上游同步

- [FORK-001] 上游 fork 的改动保持小而可合并，不做与上游冲突的架构改造，工具链优先跟随上游。
<!-- workspace-policy:end -->
