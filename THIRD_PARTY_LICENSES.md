# 第三者のライセンス

このリポジトリの画面に取り込んで配布しているもののうち、ライセンスの表記が必要なもの。

## デジタル庁デザインシステム：デザイントークン

- パッケージ：`@digital-go-jp/design-tokens` 2.0.1（npm）
- 使い方：`app/layout.tsx` で `dist/tokens.css` を読み込み、文字の大きさ・行の高さ・太さ・書体・角丸・中立の灰色・フォーカスの輪の黄色を、`app/styles/tokens.css` の基本トークンとして使っている。
- ライセンス：MIT License（全文は下記。パッケージの `LICENSE` と同じ）

```
MIT License

Copyright (c) 2023 デジタル庁

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 開発のときだけ使うもの（画面には含めない）

- `@axe-core/playwright` 4.14.0 と `axe-core`（MPL-2.0）：アクセシビリティの自動検査に使う。`devDependencies` にだけ入れ、画面のコードには取り込まない。
