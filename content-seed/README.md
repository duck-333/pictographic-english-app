# Content Seed Workflow

This folder is the first landing place for the future content admin workflow.

For now, we do not connect a real cloud database. The goal is safer and simpler:

- A content editor can prepare word records in JSON.
- A developer can validate the records before importing them.
- The mini program can later read the same shape from uniCloud or another backend.

## Files

- `words.example.json`: a small example collection with `study` and its breakdown nodes.
- `word-entry-template.json`: a blank draft template for one new word.

## How To Validate

Run this from the repository root:

```powershell
npm.cmd run validate:content
```

If `npm` works normally on your machine, `npm run validate:content` is also fine. On Windows, `npm.cmd` avoids the PowerShell `npm.ps1` execution-policy block.

Expected result:

```text
Content validation passed
```

## Editing Rules

- Keep `id` stable. For example, `word-study` should not change after users have history or favorites.
- Keep `word` lowercase English. For example, use `study`, not `Study`.
- Put the short explanation in `meaning`.
- Put the long editable explanation in `pictograph` or `richTextHtml`.
- Put clickable breakdown cards in `parts`.
- Each `parts[].targetId` must point to an existing word or node record.
- Video files should not be stored in the database. Store only `videoUrl`, `startSec`, `endSec`, and `segmentTitle`.

## Future Admin Path

When we connect uniCloud, the admin page should save records into these collections:

- `words`
- `word_nodes`
- `video_segments`
- `feedbacks`
- `user_word_states`
