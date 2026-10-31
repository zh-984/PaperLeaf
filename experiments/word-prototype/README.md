# Word 隔离验证

此目录保留 Word 自动化的隔离测试。正式桥接实现位于 desktop/word-bridge.ps1，测试通过 tests/word-invoke.mjs 调用与桌面相同的 Node 桥接。

测试只创建独立 Word 实例和 .test-data/word-smoke 中的临时文档，通过显式测试入口绑定测试文件，不操作用户文档。若无法获得独立实例则退出。覆盖 .doc、.docx 及旧内容控件，测试前插、重复引用、参考文献、保存重开、删除、中文编码、上标、字符缩进和样式更新。不要把旧的 word-bridge.ps1 原型用于实际文档。
