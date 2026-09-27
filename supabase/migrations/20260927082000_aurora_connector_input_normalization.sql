-- Aurore Archives
-- Connector input normalization
-- 2026-09-27
--
-- Purpose:
--   Normalize common connector/editorial wire formats before the canonical
--   Aurore quality gates run. This keeps the canonical stored schema stable
--   without weakening scientific, volume, visual or publication controls.
--
-- Applied in production before committing this migration.

create schema if not exists private;

create or replace function private.aurora_normalize_connector_content()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_origin text := lower(coalesce(new.metadata->>'origin',''));
  v_content jsonb := coalesce(new.content_json, '{}'::jsonb);
  v_sections jsonb := coalesce(v_content->'sections','[]'::jsonb);
  v_new_sections jsonb := '[]'::jsonb;
  v_section jsonb;
  v_content_blocks jsonb;
  v_item jsonb;
  v_normalized_blocks jsonb;
  v_idx int;
  v_decisions jsonb;
  v_decision jsonb;
  v_new_decisions jsonb := '[]'::jsonb;
  v_graphs jsonb;
  v_graph jsonb;
  v_graph_section int;
  v_existing_graph_ids text[];
  v_id text;
  v_has_section_numbers boolean := true;
  v_decision_count int;
  v_section_count int;
  v_graph_count int;
begin
  if v_origin <> 'gpt_editorial_ingest' then
    return new;
  end if;

  if jsonb_typeof(v_content) <> 'object' then
    raise exception 'CONNECTOR_NORMALIZE: content_json doit être un objet JSON.';
  end if;

  if coalesce(v_content->>'title','') = '' and coalesce(new.title,'') <> '' then
    v_content := v_content || jsonb_build_object('title', new.title);
  end if;

  if jsonb_typeof(v_sections) <> 'array' then
    raise exception 'CONNECTOR_NORMALIZE: sections doit être un tableau.';
  end if;

  v_section_count := jsonb_array_length(v_sections);

  for v_idx in 0..greatest(v_section_count - 1, -1) loop
    if v_section_count = 0 then
      exit;
    end if;

    v_section := v_sections->v_idx;
    v_content_blocks := coalesce(v_section->'content','[]'::jsonb);

    if jsonb_typeof(v_content_blocks) = 'string' then
      v_content_blocks := jsonb_build_array(v_content_blocks);
    elsif jsonb_typeof(v_content_blocks) is null then
      v_content_blocks := '[]'::jsonb;
    elsif jsonb_typeof(v_content_blocks) = 'array' then
      v_normalized_blocks := '[]'::jsonb;

      for v_item in select value from jsonb_array_elements(v_content_blocks) loop
        if jsonb_typeof(v_item) = 'string' then
          v_normalized_blocks := v_normalized_blocks || jsonb_build_array(v_item);
        elsif jsonb_typeof(v_item) = 'object'
              and jsonb_typeof(v_item->'text') = 'string' then
          v_normalized_blocks := v_normalized_blocks || jsonb_build_array(v_item->'text');
        elsif jsonb_typeof(v_item) = 'object'
              and jsonb_typeof(v_item->'content') = 'string' then
          v_normalized_blocks := v_normalized_blocks || jsonb_build_array(v_item->'content');
        else
          raise exception 'CONNECTOR_NORMALIZE: sections[%].content contient un bloc non textuel non supporté.', v_idx + 1;
        end if;
      end loop;

      v_content_blocks := v_normalized_blocks;
    else
      raise exception 'CONNECTOR_NORMALIZE: sections[%].content doit être une chaîne ou un tableau de chaînes.', v_idx + 1;
    end if;

    v_section := jsonb_set(v_section, '{content}', v_content_blocks, true);
    v_new_sections := v_new_sections || jsonb_build_array(v_section);
  end loop;

  v_content := jsonb_set(v_content, '{sections}', v_new_sections, true);

  v_decisions := v_content->'visual_plan'->'decisions';
  if jsonb_typeof(v_decisions) = 'array' then
    v_decision_count := jsonb_array_length(v_decisions);
    if v_decision_count = v_section_count and v_decision_count > 0 then
      v_has_section_numbers := true;
      for v_decision in select value from jsonb_array_elements(v_decisions) loop
        if coalesce(v_decision->>'section_number','') = '' then
          v_has_section_numbers := false;
          exit;
        end if;
      end loop;

      if not v_has_section_numbers then
        for v_idx in 0..v_decision_count-1 loop
          v_decision := v_decisions->v_idx;
          if coalesce(v_decision->>'section_number','') = '' then
            v_decision := v_decision || jsonb_build_object('section_number', v_idx + 1);
          end if;
          v_new_decisions := v_new_decisions || jsonb_build_array(v_decision);
        end loop;

        v_content := jsonb_set(
          v_content,
          '{visual_plan,decisions}',
          v_new_decisions,
          true
        );
      end if;
    end if;
  end if;

  v_graphs := v_content->'graphs';
  if jsonb_typeof(v_graphs) = 'array' and jsonb_array_length(v_graphs) > 0 then
    for v_graph in select value from jsonb_array_elements(v_graphs) loop
      v_graph_section := null;

      if coalesce(v_graph->>'section_number','') ~ '^[0-9]+$' then
        v_graph_section := (v_graph->>'section_number')::int;
      elsif coalesce(v_graph->>'section','') ~ '^[0-9]+$' then
        v_graph_section := (v_graph->>'section')::int;
      end if;

      if v_graph_section is not null
         and v_graph_section between 1 and v_section_count then
        v_idx := v_graph_section - 1;
        v_section := v_content->'sections'->v_idx;
        v_existing_graph_ids := array[]::text[];

        if jsonb_typeof(v_section->'graphs') = 'array' then
          for v_id in
            select coalesce(value->>'id','')
            from jsonb_array_elements(v_section->'graphs') value
          loop
            if v_id <> '' then
              v_existing_graph_ids := array_append(v_existing_graph_ids, v_id);
            end if;
          end loop;
        end if;

        v_id := coalesce(v_graph->>'id','');
        if v_id = '' or not (v_id = any(v_existing_graph_ids)) then
          v_section := jsonb_set(
            v_section,
            '{graphs}',
            coalesce(v_section->'graphs','[]'::jsonb) || jsonb_build_array(v_graph),
            true
          );
          v_content := jsonb_set(v_content, array['sections',v_idx::text], v_section, true);
        end if;
      end if;
    end loop;

    v_content := v_content - 'graphs';
  end if;

  v_graph_count := 0;
  for v_idx in 0..greatest(jsonb_array_length(v_content->'sections') - 1, -1) loop
    if jsonb_array_length(v_content->'sections') = 0 then
      exit;
    end if;
    if jsonb_typeof(v_content->'sections'->v_idx->'graphs') = 'array' then
      v_graph_count := v_graph_count
        + jsonb_array_length(v_content->'sections'->v_idx->'graphs');
    end if;
  end loop;

  new.content_json := v_content;
  new.metadata := coalesce(new.metadata,'{}'::jsonb)
    || jsonb_build_object(
      'connector_normalization',
      jsonb_build_object(
        'schema_version','aurora-connector-normalization-1',
        'content_blocks_canonicalized',true,
        'graph_count',v_graph_count,
        'normalized_at',now()
      )
    );

  return new;
end;
$$;

drop trigger if exists aurora_generated_documents_00_connector_normalize
  on public.aurora_generated_documents;

create trigger aurora_generated_documents_00_connector_normalize
before insert or update of content_json, metadata
on public.aurora_generated_documents
for each row
execute function private.aurora_normalize_connector_content();
