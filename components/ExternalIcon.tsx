/**
 * 外部サイトへ出るリンクに付ける矢印。
 * 「サイトを開く」「リリースノート」「お問い合わせ」「依存先のステータス」で
 * 同じ見た目にしたいので 1 か所に寄せてある。
 */
export function ExternalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
      <path d="M6 2h8v8h-2V5.4L5.4 12 4 10.6 10.6 4H6z" />
    </svg>
  );
}
