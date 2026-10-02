-- Expand NewsTeen75 approved video sources.
-- Keep the existing Sports/Entertainment/Finance sources active,
-- restore the previous Hindi/general news sources,
-- and add five Technology sources.

update public.approved_channels
set
  active = true,
  category = case
    when channel_name in (
      'DB Live',
      'National Dastak',
      '4PM News Network',
      'Jansatta',
      'NewsClick',
      'Satya Hindi',
      'The Public India',
      'Dalit Dastak',
      'Bolta Hindustan'
    ) then 'Politics'
    else 'General'
  end,
  updated_at = now()
where channel_name in (
  'The Lallantop',
  'Oneindia Hindi',
  'Live Hindustan',
  'Navbharat Times',
  'Dainik Jagran',
  'DB Live',
  'National Dastak',
  'Amar Ujala',
  '4PM News Network',
  'Jansatta',
  'NewsClick',
  'Satya Hindi',
  'News4Nation',
  'Prabhat Khabar',
  'Newslaundry',
  'The Public India',
  'News Nasha',
  'Dalit Dastak',
  'City Post Live',
  'Bolta Hindustan'
);

insert into public.approved_channels
  (
    channel_name,
    youtube_channel_id,
    youtube_handle,
    youtube_url,
    uploads_playlist_id,
    category,
    language,
    active,
    updated_at
  )
values
  ('Beebom', null, '@beebomco', 'https://www.youtube.com/@beebomco', null, 'Technology', 'en', true, now()),
  ('Trakin Tech', null, '@TrakinTech', 'https://www.youtube.com/@TrakinTech', null, 'Technology', 'hi', true, now()),
  ('Tech Burner', null, '@TechBurner', 'https://www.youtube.com/@TechBurner', null, 'Technology', 'hi', true, now()),
  ('Gadgets 360', null, '@Gadgets360', 'https://www.youtube.com/@Gadgets360', null, 'Technology', 'en', true, now()),
  ('TechWiser', null, '@TechWiser', 'https://www.youtube.com/@TechWiser', null, 'Technology', 'en', true, now())
on conflict (youtube_url) do update
set
  channel_name = excluded.channel_name,
  youtube_handle = excluded.youtube_handle,
  category = excluded.category,
  language = excluded.language,
  active = true,
  updated_at = now();
