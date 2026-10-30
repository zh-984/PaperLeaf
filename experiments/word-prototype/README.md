# Word 隔离验证

此目录保留 Word 自动化的隔离测试。正式桥接实现位于 desktop/word-bridge.ps1，测试通过 tests/word-invoke.cjs 调用与桌面相同的 Node 桥接。

测试只创建临时文档，检测到已有 Word 进程即退出，避免影响用户文档。覆盖前插、重复引用、参考文献、保存重开、删除和样式更新。不要把旧的 word-bridge.ps1 原型用于实际文档。
