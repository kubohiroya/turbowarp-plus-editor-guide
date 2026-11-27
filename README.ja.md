# TurboWarp Plus Editor Guide

Issue: https://github.com/kubohiroya/turbowarp-plus-editor/issues/724

案内UI、対象照合、実操作待ち、Scratchブロック、破棄を所有する独立MPL-2.0パッケージ。EditorはVM・document・公開APIを渡します。

Joyride 3.2.0と共有React 16.14を使用します。GUIの内部モジュールやCSSはimportしません。起動だけでは案内を表示せず、作品の明示的な呼出しで表示します。

未公開のローカル実装です。通常の保存・Undo・基本ブロックは制限しません。能力マスク、課題の編集制限、教員管理は後続の別タスクです。

## 検証と切り戻し

`npm run typecheck`、`npm test`、`npm run build`、`npm run test:browser`を変更境界に実行します。ブラウザーはヘッドレスだけを使います。

切り戻しはEditorのGuide結線と依存を戻します。作品と教材データは削除しません。

## 接続とAPI

プロジェクト読込の前に `installGuideExtension(vm)`、workspace接続時に `attachEditorGuide({vm, document, locale, getBlockly})` を呼びます。VM交換・workspace破棄時に戻り値の `dispose()` を呼びます。登録と表示を分けることで、Guideブロックを持つ保存済み作品を初期読込できます。

- `Guide.register({id, label, resolve, events})`: ホストの参照・公開portから対象を登録。重複IDを拒否します。
- `show(id, message)`: 案内を表示します。
- `showAndWait(id, message, {kind: 'click'} | {kind: 'event', event}, options)`: 実クリックまたは登録済み状態変更を待ちます。
- `notify(id, event)`: ホストから現在の対象の状態変更を通知します。
- `hide()`・`dispose()`: 表示、listener、observer、timer、待機を片付けます。
- `listTargets()`: 対象がない・隠れている・複数候補等の診断を返します。

結果は `completed / cancelled / unavailable / timeout` と理由です。人が考える待機に暗黙のtimeoutは設けません。必要な呼出しだけ `timeoutMs` または `AbortSignal` を渡します。合成クリックやJoyrideの表示だけで実操作を完了扱いにしません。

作品はCSSセレクターやHTMLを渡せません。メッセージはテキストとして表示します。同じdocument内だけを対象とし、別OSウィンドウは対象外です。悪意ある同一ページのJavaScriptを隔離する仕組みではありません。

## Scratchと最小教材

拡張IDは `kubohiroyaeditorguide`。表示、表示して待つ、閉じる、結果、理由、対象を案内できるか、を提供します。待機ブロックのACTIONは `click` または `event:workspace.changed` 等です。作品停止・切替、対象の消滅、呼出し元のScratchスレッドだけの停止、ホスト破棄で待機を解除します。

`このスプライトを [TARGET] の [SIDE] に出し [MESSAGE] と話して [ACTION] を待つ` は、呼出し元のスプライトを論理名の指すUIの隣または中央に表示します。姿・大きさ・向き・効果は実VMのrendererの公開APIから取得し、移動は表示開始時からの相対位置を反映します。セリフはこのGuideブロックのMESSAGEをテキストとして表示します。音声合成や通常の「と言う」ブロックの移設は含みません。複数シーンは既存のbroadcast receiverから順番に呼び、操作完了後に次のシーンへ進めます。

表示中はステージ側のdrawableを一時的に隠しますが、VMの `target.visible` や保存データを書き換えません。待機完了・中断・対象消滅・ホスト破棄で、現在の可視状態に従ってステージ表示へ戻します。通常のゲーム用スプライトとの接触判定等をガイド役に兼務させず、専用の案内役を用意してください。これは表示先の一時変更であり、スプライトを別VMへ複製する仕組みではありません。

## ガイド実行中の編集と保存

スプライトとセリフは `pointer-events: none` の独立表示です。フォーカスやキーボード入力を取得せず、ユーザーは他のスクリプト、スプライト、紙芝居の別部分を編集できます。待機するのはそのGuideを呼んだスレッドで、他のスクリプトは動作を続けます。実行中のスクリプトや共有変数そのものを編集した場合の影響は通常のScratch VMと同じです。実行箇所を自動で保護する機能はありません。

作品全体のSB3保存や既存のプロジェクトフォルダ保存を妨げません。保存対象はその時点の作品データであり、スレッドの実行位置やGuide表示の一時状態を保存して途中再開するものではありません。Gitパネルの差分確認・保存済み変更のコミット等にもGuide固有の制限を追加しません。保存・Gitの競合検査や権限確認は既存の各パッケージが担当します。

デバッガのログ・変数確認等を併用できます。VM全体の一時停止・ステップ実行はガイド役のVM動作にも及びます。全停止や作品読込はGuideを解除します。チェックアウト、pull後の再読込、別作品を開く等、実行対象を置き換える操作で同じ実行の継続は保証しません。既存のフォルダ連携は実行中の外部変更適用を保留します。独立したデバッグ停止やブランチ切替後のシーン再開は別の実行状態管理が必要です。

標準対象は `editor.greenFlag`、`sprite.list`、`project.search`、`code.workspace`。対象が提供・表示されていない場合は `unavailable` です。実操作の完了と学習課題の達成は別です。緑の旗は作品を再開始するため、実行を維持する教材ではworkspace等を案内します。

`examples/guide-intro.ts` は、案内を待つreceiverと無関係に動き続ける時計を持つ最小SB3を生成します。紙芝居の既存 `broadcastMessageAndWait` からreceiverを呼び、Guide操作後に物語を再開します。この経路は対応版で `dsl4Runtime` と `dsl4BroadcastMessageAndWait` を明示的に有効にする必要があります。Custom Actionの30秒timeoutを延長して代用しません。次の教材へは作品側の明示的なリンクで進み、既存の起動フラグと言語を指定します。教材用プリセットは未実装です。

## 検証条件

開発はNode 24以上を使います。ReactとReact DOMはpeerです。native ESMとwebpack 4向けCommonJS `.js` を配布し、Reactを重複搭載しません。

`GUIDE_EDITOR_BUILD=/absolute/build GUIDE_KAMISHIBAI_ROOT=/absolute/app npm run test:editor` は固定Editorの実VMと紙芝居RuntimeControllerを使うヘッドレス統合です。Appは `45f41d8bae8a0afa674d00da36a98b3090955694` の変更のないソースを使います。

この統合検証は3件です。SB3での編集・保存・中断・次作品への遷移に加え、コンパイラ有効・無効の両方で、実フォルダを開いて案内表示中のGit差分表示、フォルダ保存、選択したファイルのローカルコミットを確認します。別ファイルのステージ済み変更は維持し、無関係のスクリプトも動き続けます。実行中のブランチ切替は既存の保護により拒否されます。テスト用リポジトリにremoteは設定せず、外部へのpushは行いません。

デバッガは実際のブレークポイントから停止し、Threads表示と再開を両モードで確認します。ステップ実行はコンパイラ無効時に確認します。一時停止中にGuide対象をクリックした場合は、案内表示を閉じ、VMの再開後に紙芝居を一度だけ進めます。OSピッカーは表示せず、ヘッドレスブラウザーへテスト用フォルダのハンドルを渡します。

Gitやデバッガへのタブ切替をまたいで案内を維持する教材では、`project.search` 等の表示が残る対象を選びます。対象自体が非表示・消滅した場合は、APIの契約どおり `unavailable` で待機を終了します。

Editorの基点はmain `61c2388b0a8fd4e4a03054010fdbf36918ae23d9`、GUI `60b87e2f2503206847f509285aa4de3cee3670c7`、VM `88a2c06e9deb3dd652c52c20daf4f728b387d41d`。未公開候補はローカルpreviewとして検証し、npm限定の正式配布検査を迂回して公開しません。
