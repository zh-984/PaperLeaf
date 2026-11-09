# 本地中文 AIGC 检测

0.9.2 新增真正的本地专用分类模型，不再需要给“专用检测器”手填服务地址或 Key。打开 Work，在“检测方式”选择“本地中文专用检测”；首次点击“下载并启用”。下载约 99 MiB 模型，进度可见，SHA-256 核对通过后才能启用。下载只请求公开模型文件，不发送稿件。

本机已配置完成时会显示“本地中文检测已就绪”。仍需手动点“开始分析”；不会在导入时自动运行。其他用户从 GitHub 安装后也能一键下载。网络不通时，API 辅助分析、阅读和笔记照常可用。

## 使用和解释

- 本地模型负责逐段 AI 倾向评分、定位；选择“AI 辅助分析”仍可使用已有三组聊天 API 获取理由与修改建议。两者不是同一种检测。
- 面向中文。少于 80 个有效字母/数字字符、或中文比例低于 30% 的段落标为“信息不足”，不硬给分数。英文稿件请使用相应英文检测服务或 API 辅助分析。
- 长段按最多 512 tokens 分窗，相邻窗重叠保留上下文，按新增覆盖长度汇总；不只看开头，也不把重叠部分反复加权。
- 默认 CPU 两线程、单模型顺序推理，不要求显卡、Python 或 PyTorch。空闲一分钟释放模型会话；再次检测会重新加载。结果和分段缓存保存在本机，成功缓存可复用。
- 分数是模型的统计判断，**不是查到了 AI 的写作记录，也不是全文真实 AI 占比**。中文学术规范表达、翻译、混合创作和改写可能误报；本版本未进行代表性语料上的准确率校准，不承诺与知网/学校检测一致。

## 模型、许可和存储

原始模型：[YuchuanTian / AIGC_text_detector](https://github.com/YuchuanTian/AIGC_text_detector)，对应 ICLR 2024 的 MPU 检测方法及后续中文 v3 模型；本版使用社区导出的 [Eslzzyl / aigc-detector-zh-onnx](https://huggingface.co/Eslzzyl/aigc-detector-zh-onnx) INT8 权重。原始项目和量化模型声明 Apache-2.0 许可，许可文本见 [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)。量化版可能与原始浮点模型的分数略有差异。

固定量化仓库提交：`e6c77fd62955fac134e76deb5396806f6d35fd30`。固定模型 SHA-256：`57e5ec316f7ce764e94ba4f301cf492f3f22f22ea0cd3b385ebad847a42de40c`。三个文件的大小和校验值均写入代码；不下载可执行脚本或任意模型地址，不使用 pickle。

推理使用 Microsoft ONNX Runtime（MIT）；分词使用 Hugging Face Tokenizers.js（Apache-2.0），读取同一版本的 tokenizer.json / tokenizer_config.json。软件自己的代码仍按仓库许可证发布，不代表对模型准确率背书。

桌面默认目录：`%APPDATA%\Paperleaf\data\models\aigc-zh-v3`。Web 默认目录：`DATA_DIR/models/aigc-zh-v3`，可用服务端 `WORK_LOCAL_MODEL_DIR` 指向其他磁盘。模型不放进 GitHub 源码和主安装包，升级保留模型缓存；安装包仅包含 Windows x64 推理运行时，不夹带其他平台或 CUDA 下载。

“外部检测服务（高级，可选）”保留原来的协议适配入口，仅在你另外拥有检测 API 时填写；不是普通聊天模型的配置页。不使用外部检测服务时可以一直收起。

## 查重与 AIGC 有什么不同

**查重**是把稿件文字与本次实际取得的公开正文对照，找连续重复片段并给来源链接。当前只自动搜索 Europe PMC 和 arXiv，也支持自己补充公开链接；不覆盖整个互联网或知网。没有取到正文就显示“未计算”，不会假装是 0%。

**AIGC 检测**没有现成的“AI 原文库”可比对，而是用人写/机器生成样本训练出的模型判断写作模式。本地模型给 AI 倾向分数，聊天 API 则根据上下文给表达风险和建议，二者都需要人工核对。

开发验证：`WORK_LOCAL_MODEL_TEST=1` 时运行 `tests/local-detector-live.test.ts`，校验固定模型、真实 CPU 推理、短段拒判、无 Key 后台任务及缓存。`node tests/local-detector-desktop.mjs` 验证实际 EXE 的本地推理（先构建桌面版，并准备模型）。测试使用合成中文材料，验证工程流程，不把测试文本的分数当成准确率评测。
