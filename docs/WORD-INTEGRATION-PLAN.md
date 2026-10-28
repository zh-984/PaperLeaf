# 知页与 Word 引用联动方案（仅规划）

目标是在 Microsoft Word 中搜索知页文献、插入引用，按选定格式更新引用编号，并在文末生成参考文献。本次没有开发或安装 Word 插件。

## 推荐路线

针对目前的 Windows 本地桌面版，建议先做一个独立的 **Word VSTO 加载项 + 知页本地引用服务 + CSL 格式引擎**。Word 功能区增加“知页引用”，提供“插入引用、编辑引用、更新全部、选择样式、生成参考文献、导出无链接副本”。文献选择复用现有书架。

理由是它适合 Windows 桌面 Word，可使用内容控件和文档内 XML 保存引用身份，不需要把私人资料上传云端。VSTO 使用 .NET Framework，需按目标 Office 版本、位数及部署条件验证；它不是在现有 Electron 页面上直接加几个按钮。[Microsoft VSTO 文档](https://learn.microsoft.com/en-us/visualstudio/vsto/create-vsto-add-ins-for-office-by-using-visual-studio?view=visualstudio)、[内容控件](https://learn.microsoft.com/en-us/visualstudio/vsto/how-to-add-content-controls-to-word-documents?view=visualstudio)、[自定义 XML](https://learn.microsoft.com/en-us/visualstudio/vsto/custom-xml-parts-overview?view=visualstudio)。

若以后要支持 Mac 或网页版 Word，再评估 **Office.js 任务窗格插件**。它可复用更多 TypeScript 代码，但需要解决稳定 HTTPS 地址、Office API 版本与本地服务连接。现有随机端口的 HTTP 阅读器不能直接作为正式插件入口。微软有引用管理示例，但示例的插入尾注功能不等同于完整的引用编号维护系统。[官方引用示例](https://learn.microsoft.com/en-us/samples/officedev/office-add-in-samples/word-citation-management/)、[HTTPS 开发要求](https://learn.microsoft.com/en-us/office/dev/add-ins/tutorials/word-tutorial)、[Office 插件运行环境](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/browsers-used-by-office-web-add-ins)。

第一步应确认用户实际使用的 Microsoft Word 版本及 32/64 位。WPS 不预设兼容；LibreOffice、在线协作和手机 Word 不在首版范围。

## 用户操作

1. 在知页文献上补齐并确认引用资料：标题、作者顺序、年份、期刊、卷期页、DOI、文献类型等。
2. 在 Word 放置光标，点“插入引用”，按书架或标题选择文献，可一次选多篇，并添加引用页码、前后缀。
3. 文中显示 `[1]`、`[2–4]` 或作者年份形式；插件保存真实文献 ID 和引用组 ID。
4. 点“生成参考文献”，在文末插入插件管理的参考文献区块。已有区块则更新，避免重复追加。
5. 改动后点“更新全部”，按文中实际出现顺序重新扫描、去重、编号，并依所选 CSL 样式排序文末条目。
6. 提交前可导出一份纯文本引用副本，保留原始文档继续维护动态引用。

例如原有 A→B 对应 `[1]`、`[2]`，在 A 前插入 C，更新后变成 C=`[1]`、A=`[2]`、B=`[3]`；再次引用 A 沿用同一编号。作者年份样式则按照样式规则生成，不套用数字编号规则。

## 数据和引用身份

当前 Paper 主要负责 PDF 阅读，缺少完整书目数据。需要新增 Reference 实体，与 Paper 关联；作者使用有序数组，缺失字段留空并提示核对，不能让 AI 猜作者、DOI 或期刊。

每组引用用独立的 UUID，记录 referenceId、locator、prefix/suffix。用 Word 内容控件标识引用位置，在 DOCX 的自定义 XML 中保存引用组数据、样式 ID 和 CSL-JSON 书目快照；文末参考文献也有单独的受控区块。不能只插入普通字符串 `[1]`，否则无法可靠识别插入、删除与编号变化。

更新时按文档中的位置顺序扫描插件自己的引用组，再由格式引擎处理编号与排序。只修改知页管理的区块，不改正文其他段落，不接管 EndNote/Zotero 字段。文末采用专用段落样式，支持悬挂缩进、斜体及间距。

格式引擎可评估 [citeproc-js](https://github.com/Juris-M/citeproc-js) 与 CSL 样式，先验证目标学校要求的 GB/T 7714 具体版本，以及 APA、IEEE。样式和引擎的分发许可需在实施前核查。引用格式化由确定性规则完成，不依赖 AI，不产生模型费用。

## 本地通信与隐私

建议 VSTO 与本机知页通过仅当前用户可访问的命名管道通信，设置访问控制和配对认证，服务端仍做参数验证。插件通过服务接口取引用数据，不直接共享写入 SQLite，也不接收 AI Key。命名管道桥接及安装生命周期需要先做最小原型验证。

DOCX 内保存书目快照，使文档移动到其他电脑后仍保留已渲染引用和参考文献。插入新文献、从书架同步资料需要本地应用运行；离线更新能否完全依靠快照，应在插件原型阶段确定。文献从书架删除后应保留文档快照，并显示失联提示，不能悄悄删除 Word 中的引用。

## 实施顺序与验收

- 第一批：补齐书目数据与核对界面、CSL 预览和可导出的标准数据。
- 第二批：Windows Word 插件，插入单篇/多篇引用、编辑页码、手动更新全部、文末参考文献与样式切换。
- 第三批：在保存前更新、复制粘贴引用组、撤销重做、修订模式、表格与脚注等兼容性；必要时再考虑 Office.js。

首版不承诺每次任意键入都实时重排：先保证“更新全部”稳定，再加入有防抖和失败恢复的自动更新。必须专门验证前插引用后重编号、重复引用不重复列出、删引用后的处理、样式切换、重启、文档搬移、同一引用复制后 ID 冲突，以及 100 篇以上引用的性能。上述为待实施验收项，本次未声称测试通过。

## 主要风险

引用数据准确性比格式按钮更关键。Word 修订、协作、受保护文档、复制粘贴及他人手工改写控件都可能影响引用识别，需要明确支持边界；加载项安装还需处理 Office 信任策略、签名和更新。应先验证一个真实 Word 环境，再决定正式开发范围。
