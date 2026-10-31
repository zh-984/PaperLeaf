# 知页与 Word 联动

Windows 桌面版可从“文献引用”页插入到当前打开的 Microsoft Word 文档，并更新引用编号和文末参考文献。先在 Word 正文放好光标，再在知页点击“插入到 Word”。修改引用位置、删除引用或调整格式后，点击“更新 Word 引用与参考文献”。最后在 Word 自行检查和保存。

同一文献共用编号，按正文首次出现顺序排列。作者使用分号分隔，超过三人保留前三人，按第一作者是否含中文选择“等”或“et al.”。自定义模板在知页编辑，更新操作会应用到文档。文档保存书目快照，知页书架删除原文献后仍可依靠文档快照更新。

## 上标与文末排版

正文引用默认以上标显示，例如上标的 [1]、[2]，可在“文中标号显示”改为普通文字。标号后的正常输入不会继承上标。文末条目保持普通文字，可选择无缩进、首行缩进或悬挂缩进，字符数支持 0–10（如 1.5、2）。标题“参考文献”不应用条目缩进。修改后点击“更新 Word 引用与参考文献”。

格式输入框下方的“格式字段对照表”说明每个占位符。可按期刊要求编辑字段顺序、标点及字段取舍。例如：`[{{number}}] {{authors}}. {{title}}[{{type}}]. {{journal}}, {{year}}, {{volume}}({{issue}}): {{pages}}.`。这些是可编辑文本模板，不是完整 CSL 样式引擎；缺失字段的空括号和重复标点会清理，但仍需人工核对最终格式。

## 旧版 .doc 文档兼容

0.8.4 使用内容控件，旧版 .doc（Word 97–2003，CompatibilityMode 11）不实现该功能，会报“insert citation: 未实现该方法或操作”。0.8.5 新插入改用 Word ADDIN 域，书目快照保存在域代码中，无需转换文档格式。已支持 .doc 和 .docx 保存重开；旧 .docx 内容控件引用继续参与编号和更新，不要求重建文档。不要手动改动或删除域代码；删除引用时删除完整引用标号，再点击更新。如用 Alt+F9 看到了域代码，可再次按 Alt+F9 返回正常显示。

目前仅支持 Windows 桌面 Word 主文档正文。修订模式、只读、保护文档、页眉和脚注引用不支持。Word 功能区独立插件入口尚未实现；当前必须从知页点击操作。操作不自动保存文件，可在 Word 撤销；失败时会尝试撤销本轮更改。Word 有对话框时先关闭对话框再操作。

实现研究参考了 [Zotero Word 联动架构](https://github.com/zotero/zotero-word-for-windows-integration/blob/master/build/zoteroWinWordIntegration/document.cpp) 中先创建 QUOTE 域再写入 ADDIN 域代码的方式，未复制其源码或使用其商标。源码下载在用户指定的 D:/wyproject_intresting/zotero/word-integration。知页桌面桥接使用独立实现的 PowerShell COM 操作，原有 MIT 许可未改变。缩进使用 Word 的 CharacterUnitLeftIndent / CharacterUnitFirstLineIndent，按字符计量。

隔离测试命令：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File experiments/word-prototype/word-bridge-smoke.ps1`。覆盖 .doc、.docx、旧内容控件引用三种文档：前插重编号、重复引用去重、单个文末区块、保存重开、书目信息更新、上标及普通文字切换、三种缩进、删除引用后的重排。测试在独立 Word 实例及 .test-data/word-smoke 临时文件运行，不修改打开的用户文档。尚未承诺完整 CSL 标准、多人协作或所有 Office 版本兼容性。
