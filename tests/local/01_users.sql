-- テスト用ユーザー（トリガーでプロフィールと同意の記録が作られるかも確認）
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'salon-a@demo.test', '{"display_name":"サロンAスタッフ"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'salon-b@demo.test', '{"display_name":"サロンBスタッフ"}'),
  ('00000000-0000-4000-8000-0000000000ad', 'admin@demo.test',   '{"display_name":"運営"}'),
  ('00000000-0000-4000-8000-000000000001', 'user1@demo.test',
   '{"display_name":"山田 花子","phone":"090-0000-0001","gender":"female","age_group":"20s","occupation":"会社員",
     "area_id":"e0000001-0000-4000-8000-000000000001","conversation_pref":"quiet","adult_confirmed":"true","terms_version":"2026-10"}'),
  ('00000000-0000-4000-8000-000000000002', 'user2@demo.test',
   '{"display_name":"鈴木 一郎","phone":"090-0000-0002","gender":"male","age_group":"30s","occupation":"自営業",
     "area_id":"e0000001-0000-4000-8000-000000000001","adult_confirmed":"true","terms_version":"2026-10"}'),
  ('00000000-0000-4000-8000-000000000003', 'user3@demo.test',
   '{"display_name":"田中 三郎","phone":"090-0000-0003","gender":"bogus","adult_confirmed":"true","terms_version":"2026-10"}'),
  ('00000000-0000-4000-8000-000000000004', 'user4@demo.test',
   '{"display_name":"佐々木 四葉","phone":"090-0000-0004","gender":"female"}'),
  ('00000000-0000-4000-8000-000000000005', 'user5@demo.test',
   '{"display_name":"高木 五月","phone":"090-0000-0005","gender":"female","age_group":"40s","occupation":"学生",
     "area_id":"e0000001-0000-4000-8000-000000000001","adult_confirmed":"true","terms_version":"2026-10"}'),
  ('00000000-0000-4000-8000-000000000006', 'user6@demo.test',
   '{"display_name":"森 六花","phone":"090-0000-0006","gender":"female","adult_confirmed":"true","terms_version":"2026-10"}'),
  ('00000000-0000-4000-8000-000000000007', 'user7@demo.test',
   '{"display_name":"林 七海","phone":"090-0000-0007","gender":"female","adult_confirmed":"true","terms_version":"2026-10"}'),
  ('00000000-0000-4000-8000-0000000000c9', 'new-salon@demo.test', '{"display_name":"新しいサロンのスタッフ"}');

insert into public.salon_members (salon_id, user_id) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000a1'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-0000000000b1');

insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000ad');

-- 利用者1のカルテ
update public.profiles set hair_type = '細くやわらかい', color_history = '3か月前にブラウン'
where id = '00000000-0000-4000-8000-000000000001';
