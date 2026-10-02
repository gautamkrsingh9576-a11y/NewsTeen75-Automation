-- Replace NewsTeen75 approved YouTube video sources with Sports,
-- Entertainment, and Finance/Business channels only.

update public.approved_channels
set active = false,
    updated_at = now();

insert into public.approved_channels
  (channel_name, youtube_channel_id, youtube_handle, youtube_url, uploads_playlist_id, category, language, active, updated_at)
values
  ('Sports Tak', null, '@SportsTak', 'https://www.youtube.com/@SportsTak', null, 'Sports', 'hi', true, now()),
  ('Cricbuzz', null, '@cricbuzz', 'https://www.youtube.com/@cricbuzz', null, 'Sports', 'en', true, now()),
  ('CricTracker', 'UC5oTaFLOFlLNeAJt_dt5rBw', '@CricTracker', 'https://www.youtube.com/@CricTracker', null, 'Sports', 'en', true, now()),
  ('RevSportz', 'UCjGC9zWjHHF6CG1j8YfJK9g', '@Revsportz', 'https://www.youtube.com/@Revsportz', null, 'Sports', 'en', true, now()),
  ('Sports Yaari', 'UCjFw-0Vdfy2KW78NClGECXw', '@sportsyaari', 'https://www.youtube.com/@sportsyaari', null, 'Sports', 'hi', true, now()),
  ('ESPNcricinfo', null, '@espncricinfo', 'https://www.youtube.com/@espncricinfo', null, 'Sports', 'en', true, now()),

  ('Pinkvilla', null, '@pinkvilla', 'https://www.youtube.com/@pinkvilla', null, 'Entertainment', 'en', true, now()),
  ('Bollywood Bubble', 'UCkul0EjxFOR2hS_0tOokGag', '@BollywoodBubbleNews', 'https://www.youtube.com/@BollywoodBubbleNews', null, 'Entertainment', 'hi', true, now()),
  ('Filmibeat', null, '@filmibeat', 'https://www.youtube.com/@filmibeat', null, 'Entertainment', 'hi', true, now()),
  ('Instant Bollywood', 'UCu6yNd31ATbr5CibAwJ5iwA', '@InstantBollywood_Official', 'https://www.youtube.com/@InstantBollywood_Official', null, 'Entertainment', 'hi', true, now()),
  ('Viral Bhayani', 'UCPfpwe4tq10_DRl1doR_DlA', '@ViralBhayaniofficial', 'https://www.youtube.com/@ViralBhayaniofficial', null, 'Entertainment', 'hi', true, now()),
  ('PeepingMoon', 'UCv5k3vIjch04MI__uPWzf5A', '@peepingmoon2646', 'https://www.youtube.com/@peepingmoon2646', null, 'Entertainment', 'hi', true, now()),

  ('Mint', null, '@livemint', 'https://www.youtube.com/@livemint', null, 'Finance', 'en', true, now()),
  ('Moneycontrol', null, '@moneycontrol', 'https://www.youtube.com/@moneycontrol', null, 'Finance', 'en', true, now()),
  ('Business Standard', null, '@businessstandard', 'https://www.youtube.com/@businessstandard', null, 'Finance', 'en', true, now()),
  ('Financial Express', 'UCmk6ZFMy1CT80orXca4tKew', '@FinancialExpress', 'https://www.youtube.com/@FinancialExpress', null, 'Finance', 'en', true, now()),
  ('Groww', null, '@Groww', 'https://www.youtube.com/@Groww', null, 'Finance', 'hi', true, now()),
  ('ET Money', null, '@etmoney', 'https://www.youtube.com/@etmoney', null, 'Finance', 'en', true, now())
on conflict (youtube_url) do update
set
  channel_name = excluded.channel_name,
  youtube_channel_id = coalesce(excluded.youtube_channel_id, public.approved_channels.youtube_channel_id),
  youtube_handle = excluded.youtube_handle,
  uploads_playlist_id = case
    when public.approved_channels.youtube_handle is distinct from excluded.youtube_handle
      or (excluded.youtube_channel_id is not null and public.approved_channels.youtube_channel_id is distinct from excluded.youtube_channel_id)
    then null
    else public.approved_channels.uploads_playlist_id
  end,
  category = excluded.category,
  language = excluded.language,
  active = true,
  updated_at = now();
