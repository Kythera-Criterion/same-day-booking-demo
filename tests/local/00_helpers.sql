-- テストの判定を記録する補助（ローカル検証用。t スキーマに置く）
create schema t;
grant usage on schema t to public;

create table t.results (
  n      serial primary key,
  name   text not null,
  ok     boolean not null,
  detail text
);
grant select, insert on t.results to public;
grant usage on sequence t.results_n_seq to public;

-- テストの基準時刻など（テスト中に参照する値）
create table t.ctx (key text primary key, value text);
grant select, insert on t.ctx to public;

-- 条件が成り立つことを記録する
create function t.ok(p_name text, p_ok boolean, p_detail text default null)
returns boolean language plpgsql as $$
begin
  insert into t.results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  return coalesce(p_ok, false);
end;
$$;

-- SQL がエラーになり、メッセージに p_expect を含むことを記録する
create function t.raises(p_name text, p_sql text, p_expect text)
returns boolean language plpgsql as $$
declare
  msg text;
begin
  begin
    execute p_sql;
    msg := '(エラーにならなかった)';
  exception when others then
    msg := sqlerrm;
  end;
  return t.ok(p_name, position(p_expect in msg) > 0, msg);
end;
$$;

-- SQL がエラーにならないことを記録する
create function t.runs(p_name text, p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return t.ok(p_name, true);
exception when others then
  return t.ok(p_name, false, sqlerrm);
end;
$$;

-- 1行1列の値を返す（エラーのときは ERROR: から始まる文字列）
create function t.val(p_sql text)
returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
exception when others then
  return 'ERROR: ' || sqlerrm;
end;
$$;

-- テスト用の時刻（基準時刻からの分数）
create function t.at(p_min int)
returns timestamptz language sql stable as $$
  select (select value::timestamptz from t.ctx where key = 'base') + make_interval(mins => p_min);
$$;

grant execute on all functions in schema t to public;
