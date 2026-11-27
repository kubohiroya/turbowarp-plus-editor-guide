# TurboWarp Plus Editor Guide

TurboWarp Plus EditorのUIを論理名で案内する独立MPL-2.0パッケージです。Scratch拡張からガイド役のスプライトとセリフをステージ外に表示し、ユーザーの操作を待って紙芝居のシーンを進められます。

```sh
npm install @kubohiroya/turbowarp-plus-editor-guide
```

[接続方法、ブロック、制約、検証手順（日本語）](README.ja.md)

Editor側でVM・document・共有Reactを渡す組み込み機能です。機能実装はこのパッケージが所有し、Scratch GUIの内部モジュールはimportしません。
