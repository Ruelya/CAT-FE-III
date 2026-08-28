# 产品需求（索引）

Translunar CAT 的长期立意：开源的通用计算机辅助翻译软件，同时是翻译资产
（TM / 术语）的沉淀中枢，AI 贯穿但永远停在人工审校门前。

当前实现状态以代码和审计为准，不再维护单一的大 PRD 文档：

- **当前完整度**：[`research/completeness.md`](research/completeness.md) ——
  逐维度对照代码的完整度审计（RPC 面、TM / 术语 / QA / AI、测试健康、已知缺口）。
- **已落地的分片 PRD**（描述已实现行为）：
  - [`prd/workbench-refactor.md`](prd/workbench-refactor.md) —— 工作台信息架构
  - [`prd/mt-agent-modes.md`](prd/mt-agent-modes.md) —— MT / Agent 辅助模式
  - [`prd/s3-multi-tm.md`](prd/s3-multi-tm.md) —— 多 TM 挂载与写回
  - [`prd/s3-qa-package.md`](prd/s3-qa-package.md) —— QA 规则包与豁免
- **架构边界**：[`architecture.md`](architecture.md)。
- **明确的范围外**（当前阶段不做）：安装器与代码签名、自动更新、协作、
  PDF 导入；AI 连接器仅限运行时配置的 OpenAI 兼容端点。
