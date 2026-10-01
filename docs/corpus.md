# Corpus data and portable files

Each novel owns one `corpusData` array. Writer's corpus panel, AI material selection/retrieval, mind maps and full backups read this same collection. The unused, non-persistent `novel` store corpus state and its standalone actions have been removed.

In Writer, open **语料库**, then use **导入** or **导出**. Imports append to the selected novel and wait for persistence before reporting success. They never overwrite existing records; colliding IDs receive unused IDs. A failed save restores the previous list. File decoding and saving share the material mutation barrier, so navigation and other material saves wait, and a late result cannot enter a different novel.

Legacy `corpus.json` exports are accepted as arrays of `{ id, content, createdAt }`. Titles missing from older entries are derived from the beginning of their content. Titles, categories, tags, timestamps and additional metadata are preserved. The whole file is validated before any entries are added; malformed items reject the import.

New exports use `{ "format": "llm-writer-corpus", "version": 1, "items": [...] }` and can be imported with the same button. Full backups still store corpus entries inside `novels[].corpusData`; their format has not changed. The old store corpus existed only in memory, so there is no separate persisted store collection to migrate automatically. Use a previously exported JSON file to recover those entries.
