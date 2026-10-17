-- Picture colour for each story (the app's Vivid theme). Run once in Supabase > SQL Editor.
alter table stories add column if not exists tint text;
