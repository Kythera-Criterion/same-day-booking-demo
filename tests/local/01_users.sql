-- テスト用ユーザー（トリガーでプロフィールが作られるかも確認）
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'salon-a@demo.test', '{"display_name":"サロンAスタッフ"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'salon-b@demo.test', '{"display_name":"サロンBスタッフ"}'),
  ('00000000-0000-4000-8000-000000000001', 'user1@demo.test',   '{"display_name":"山田 花子","phone":"090-0000-0001","gender":"female"}'),
  ('00000000-0000-4000-8000-000000000002', 'user2@demo.test',   '{"display_name":"鈴木 一郎","phone":"090-0000-0002","gender":"male"}'),
  ('00000000-0000-4000-8000-000000000003', 'user3@demo.test',   '{"display_name":"田中 三郎","phone":"090-0000-0003","gender":"bogus"}');

insert into public.salon_members (salon_id, user_id) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000a1'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-0000000000b1');
