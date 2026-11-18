(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const specs = [['kcal','Калории','ккал'],['protein_g','Белки','г'],['fat_g','Жиры','г'],['carbs_g','Углеводы','г']];
  const fmt = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2});
  let current, selected, today, busy = false, refreshing = false, session = false, sequence = 0;
  let pending = null, accessToken = '';
  let apiBase = '';
  const configuredBase = window.RITM_CONFIG?.API_BASE || '';
  const text = (tag, cls, value) => { const n=document.createElement(tag); n.className=cls; n.textContent=value; return n; };
  const number = value => value === null || value === undefined ? '—' : fmt.format(Number(value));
  const isRange = goal => goal !== null && typeof goal === 'object';
  const goalScale = goal => isRange(goal) ? Number(goal.max) : Number(goal);
  const rangeLabel = (goal, unit) => 'диапазон '+goal.min+'–'+goal.max+' '+unit;
  function button(label, action, cls='small-button') { const n=text('button',cls,label); n.type='button'; n.onclick=()=>run(action); return n; }
  function notice(message) { $('storage-warning').textContent=message; $('storage-warning').hidden=false; }
  async function api(path, body) {
    const headers=body?{'Content-Type':'application/json'}:{};
    if(accessToken)headers.Authorization='Bearer '+accessToken;
    const response=await fetch(apiBase+path,{method:body?'POST':'GET',credentials:'omit',mode:'cors',cache:'no-store',headers,body:body?JSON.stringify(body):undefined});
    if(response.status===401) { session=false; accessToken=''; throw new Error('Сессия истекла. Открой приложение заново из Telegram.'); }
    if(!response.ok) throw new Error('Сервер не подтвердил операцию ('+response.status+').');
    return response.json();
  }
  async function mutate(path, fields) {
    // A network-ambiguous retry retains the exact request ID and payload; no fresh ID on retry.
    const payload={...fields,request_id:crypto.randomUUID()};
    pending={path,payload}; retry.hidden=false;
    try { const result=await api(path,payload); pending=null; retry.hidden=true; return result; }
    catch(error) { notice(error.message+' Для повтора последней операции нажми «Повторить запись».'); throw error; }
  }
  async function run(action) {
    if(busy)return;
    if(pending) { notice('Сначала повтори неподтверждённую запись.'); return; }
    busy=true;
    try { await action(); await refresh(); }
    catch(error) { notice(error.message); }
    finally { busy=false; }
  }
  function shifted(key, offset) { const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10); }
  async function select(key) { selected=key; await refresh(); }
  async function refresh() {
    if(!session||refreshing)return;
    refreshing=true; const ticket=++sequence;
    try {
      const key=selected;
      const value=await api('/api/day'+(key?'?day='+encodeURIComponent(key):''));
      if(ticket!==sequence||selected!==key)return;
      today=value.today; selected=value.day; current=value;
      render();
      const monday=shifted(selected,-((new Date(selected+'T12:00:00Z').getUTCDay()+6)%7));
      const history=await api('/api/history?start='+monday+'&end='+shifted(monday,6));
      if(ticket===sequence)renderWeek(history,monday);
    } catch(error) { notice(error.message+' На экране могут оставаться устаревшие данные.'); }
    finally { refreshing=false; }
  }
  function render() {
    const {totals,goals,habits,water,meals,report}=current;
    $('date-text').textContent=new Date(selected+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'});
    $('date-picker').value=selected; $('date-picker').max=today; $('next-day').disabled=selected>=today; $('back-today').hidden=selected===today;
    $('page-title').textContent=selected===today?'Мой день':'Мой день · история';
    $('macros').replaceChildren();
    for(const [key,name,unit] of specs) {
      const nutrient=totals.macros[key],value=nutrient.known_total,goal=goals[key];
      const box=text('div','macro',''); box.append(text('div','macro-name',name));
      const line=text('div','macro-number',number(value));line.append(text('span','macro-unit',unit));box.append(line);
      const target=text('div','macro-target',goal===null?'цель не задана':'Цель');
      if(goal!==null)target.append(text('span','target-value',isRange(goal)?goal.min+'–'+goal.max+' '+unit:number(goal)+' '+unit));
      box.append(target);
      const track=text('div','bar-track',''), fill=text('div','bar-fill',''),scale=goalScale(goal);fill.style.width=scale>0&&value!==null?Math.min(100,Number(value)/scale*100)+'%':'0%';track.append(fill);
      if(isRange(goal)) {
        track.setAttribute('aria-label',rangeLabel(goal,unit)+'; верхняя граница — только шкала');
        track.style.position='relative';
        const threshold=text('span','range-threshold','');threshold.style.position='absolute';threshold.style.left=(scale>0?Number(goal.min)/scale*100:0)+'%';threshold.style.top='0';threshold.style.height='100%';threshold.style.borderLeft='2px solid currentColor';threshold.title='Нижняя граница '+goal.min+' '+unit;track.append(threshold);
      }
      box.append(track);
      $('macros').append(box);
    }
    const active=habits.filter(h=>h.active),done=active.filter(h=>h.completed===true).length,percent=active.length?Math.round(done/active.length*100):null;
    $('habit-list').replaceChildren();
    for(const h of active) {
      const b=button('',()=>mutate(`/api/habits/${h.id}/${h.completed?'undo':'complete'}`,{day:selected}),'habit-row');
      b.setAttribute('aria-pressed',String(h.completed===true));
      b.append(text('span','habit-icon',h.completed?'✓':'○'),text('span','habit-copy',h.name),text('span','habit-status',h.completed?'Готово':'Нет отметки'),text('span','habit-check',h.completed?'✓':''));
      $('habit-list').append(b);
    }
    $('habits-empty').hidden=active.length>0;$('habit-counter').textContent=done+' / '+active.length;
    $('habit-foot').hidden=!active.length;$('daily-progress').hidden=!active.length;
    $('manage-habits').textContent=active.length?'Изменить':'+ Добавить';
    $('day-percent').textContent=percent===null?'—':percent+'%';$('day-count').textContent=done+' из '+active.length+' привычек';
    $('ring-fill').style.strokeDashoffset=String(276.46*(1-(percent||0)/100));$('daily-ring').setAttribute('aria-label',done+' записанных выполнений из '+active.length);
    $('day-message').textContent='Нет отметки — не значит не выполнено.';$('day-short').textContent=selected===today?'Сегодня':selected;
    const ml=totals.water.total_ml,goal=goals.water_ml;
    $('water-value').textContent=ml===null?'—':number(Number(ml)/1000)+' л';$('water-goal').textContent=goal===null?'цель не задана':isRange(goal)?(Number(goal.min)===Number(goal.max)?'Цель '+number(goal.min)+' мл':rangeLabel(goal,'мл')):'/ '+number(Number(goal)/1000)+' л';
    const scale=goalScale(goal),level=137-(scale>0&&ml!==null?Math.min(1,Number(ml)/scale):0)*112;
    $('water-fill').setAttribute('aria-label',isRange(goal)?rangeLabel(goal,'мл')+'; верхняя граница — только шкала':'Записанная вода');
    $('water-fill').setAttribute('y',level);$('water-fill').setAttribute('height',142-level);$('water-wave').setAttribute('d',`M29 ${level}q20-5 41 0t42 0v5H29Z`);
    $('water-message').textContent=ml===null?'Нет записей о воде':'Записано: '+water.length+' событий';$('water-add-label').textContent='250 мл';$('undo-water').disabled=!water.length;
    $('meals-list').replaceChildren();
    if(!meals.length)$('meals-list').append(text('p','dialog-help','Нет записей о еде. Добавляй еду в личном диалоге с агентом.'));
    for(const meal of meals) {
      const row=text('div','manage-row',''),copy=text('div','habit-copy',meal.source_text);
      copy.append(text('p','dialog-help',specs.map(([k,,u])=>number(meal.macros[k].value)+' '+u+(meal.macros[k].accuracy==='estimated'?' ≈':'')).join(' · ')));
      row.append(copy,button('Исправить',async()=>{
        const raw=prompt('КБЖУ всей порции, JSON. Пропущенные значения станут неизвестными. Например: {"kcal":{"value":"120","accuracy":"estimated"}}',JSON.stringify(meal.macros));
        if(raw!==null)await mutate(`/api/meals/${meal.id}/update`,{macros:JSON.parse(raw)});
      }),button('Удалить',async()=>{if(confirm('Удалить запись? История отчётов сохраняется.'))await mutate(`/api/meals/${meal.id}/delete`,{});}));$('meals-list').append(row);
    }
    $('report-text').replaceChildren();
    if(!report)$('report-text').append(text('p','dialog-help','Сохранённый отчёт пока не сформирован. Текущие суммы показаны выше.'));
    else {
      $('report-text').append(text('p','dialog-help','Версия '+report.version+' · '+report.generated_at+' · только записанные данные'));
      for(const [key,name,unit] of specs)$('report-text').append(text('p','',name+': '+number(report.macros[key].known_total)+' '+unit+'; неизвестных записей: '+report.macros[key].missing_entries));
      $('report-text').append(text('p','','Вода: '+number(report.water.total_ml)+' мл'));
    }
  }
  function renderWeek(history,monday) {
    const dates=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'Europe/Moscow'});
    const start=new Date(monday+'T12:00:00Z'),end=new Date(shifted(monday,6)+'T12:00:00Z');
    $('week-period').textContent=dates.formatRange?dates.formatRange(start,end):dates.format(start)+' — '+dates.format(end);$('week-chart').replaceChildren();
    $('week-percent').textContent='—';$('week-caption').textContent='Только дни с записями; отсутствие данных не равно нулю.';$('week-demo').hidden=true;
    for(let i=0;i<7;i++) {
      const key=shifted(monday,i),entry=history.find(x=>x.day===key),count=entry?.habits.active_count,done=entry?.habits.completed_count,pct=count?Math.round(done/count*100):null;
      const b=button('',()=>select(key),'week-day');b.disabled=key>today;b.setAttribute('aria-pressed',String(key===selected));
      const bar=text('span','week-bar',''),fill=text('span','week-fill','');fill.style.height=(pct||0)+'%';bar.append(fill);
      b.append(text('span','week-pct',pct===null?'—':pct+'%'),bar,text('span','week-dayname',['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][i]),text('span','week-date',key.slice(-2)));$('week-chart').append(b);
    }
  }
  function manage() {
    $('manage-list').replaceChildren();
    for(const h of current.habits) {
      const row=text('div','manage-row',''),input=document.createElement('input');input.value=h.name;input.maxLength=80;
      row.append(input,button('Сохранить',()=>mutate(`/api/habits/${h.id}/update`,{name:input.value})),button(h.active?'Скрыть':'Вернуть',()=>mutate(`/api/habits/${h.id}/update`,{active:!h.active})));
      $('manage-list').append(row);
    }
    $('manage-dialog').showModal();
  }
  async function load() {
    $('loading-state').hidden=false;$('error-state').hidden=true;$('app').hidden=true;
    try {
      if(!configuredBase)throw new Error('Подключение к серверу не настроено. HTTPS-адрес backend ещё не предоставлен. Это не live-режим; данные не загружаются.');
      const endpoint=new URL(configuredBase);
      if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Нужен корректный публичный HTTPS-адрес backend.');
      apiBase=configuredBase.replace(/\/$/,'');
      const tg=window.Telegram?.WebApp;
      if(!tg?.initData)throw new Error('Открой Ритм через Mini App в личном Telegram-боте. Внешний браузер не авторизован.');
      tg.ready();tg.expand();
      accessToken='';
      const auth=await api('/api/session',{initData:tg.initData});accessToken=auth.access_token;session=true;
      await refresh();if(!current)throw new Error('Данные не загружены.');
      $('profile-name').textContent='Светлана';$('greeting').textContent='Всё важное для заботы о себе — здесь.';
      $('app').hidden=false;
    }catch(error){$('error-state').hidden=false;$('load-error-text').textContent=error.message;}
    finally{$('loading-state').hidden=true;}
  }
  $('retry').onclick=load;
  $('previous-day').onclick=()=>run(()=>select(shifted(selected,-1)));$('next-day').onclick=()=>run(()=>select(shifted(selected,1)));$('back-today').onclick=()=>run(()=>select(today));$('date-picker').onchange=e=>run(()=>select(e.target.value));
  $('add-water').onclick=()=>run(()=>mutate('/api/water',{day:selected,ml:'250',source_text:'Mini App: вода'}));
  $('undo-water').onclick=()=>run(()=>mutate(`/api/water/${current.water.at(-1).id}/undo`,{}));
  $('manage-habits').onclick=manage;$('close-manage').onclick=()=>$('manage-dialog').close();$('save-habits').textContent='Закрыть';$('save-habits').onclick=()=>$('manage-dialog').close();
  $('add-habit-form').onsubmit=e=>{e.preventDefault();run(async()=>{await mutate('/api/habits',{name:$('new-habit').value,start_date:selected});$('new-habit').value='';$('manage-dialog').close();});};
  const retry=button('Повторить запись',async()=>{});retry.id='retry-entry';retry.hidden=true;retry.onclick=async()=>{if(!pending||busy)return;busy=true;try{await api(pending.path,pending.payload);pending=null;retry.hidden=true;$('storage-warning').hidden=true;await refresh();}catch(e){notice(e.message);}finally{busy=false;}};
  $('storage-warning').after(retry);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.addEventListener('focus',refresh);setInterval(()=>{if(!document.hidden)refresh();},15000);
  load();
})();
