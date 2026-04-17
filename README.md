# musicgame

ブラウザで遊べる 6 レーン（S D F J K L）縦スクロール音ゲーです。  
曲選択 → プレイ → リザルトまでを実装しています。

## 起動方法

```bash
npm install
npm run dev
```

本番ビルド:

```bash
npm run build
```

## 操作方法

- 曲選択:
  - クリックで曲選択
  - Enter / PLAY ボタンで開始
- プレイ:
  - キーボード: `S D F J K L`
  - マウス/タップ: レーンを直接クリック/タップ
  - `ESC`: ポーズ（Resume / Retry / Back to Select）
- デバッグ時オフセット調整:
  - `[` / `]` で `calibrationOffsetMs` を ±1ms
  - `Shift + [` / `Shift + ]` で ±5ms

## デバッグ曲の使い方

- `Debug Metronome 120 BPM` を選択
- 0.5 秒間隔のクリック音と同タイミングでノーツ判定が来ます
- 右側の Debug パネルで以下を確認できます:
  - 入力 delta(ms) 最新 10 件
  - ミニヒストグラム
  - 現在の calibrationOffsetMs
- オフセット調整で平均 delta が 0ms 付近になるように合わせてください

## 既知の制限

- 曲音源は WebAudio 生成音（外部音源ファイルは未使用）
- ノーツ種別は TAP のみ（HOLD/SLIDE は未対応）
- リザルトヒストグラムは簡易表示です
