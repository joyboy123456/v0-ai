# Fix image upload form parse failure

## Goal

Fix the upload failure shown in the workbench where a valid image upload returns:

`上传请求解析失败，请确认图片文件有效后重试`

The screenshot image is a valid PNG, so the fix should make generation-reference uploads robust for large screenshots and high-resolution images without changing unrelated upload flows.

## Scope

- Restore client-side image preparation when `optimizeForGeneration` is enabled.
- Keep original-file behavior for upload boxes that do not opt into generation preparation.
- Preserve clear client-side size validation and server-side validation.
- Do not touch git branching or commits for this task.

## Acceptance

- A valid large PNG can be prepared into an uploadable image before posting to `/api/assets/upload`.
- Prepared uploads preserve readable dimensions and preview state.
- Existing TypeScript and lint checks remain valid for the changed code.
