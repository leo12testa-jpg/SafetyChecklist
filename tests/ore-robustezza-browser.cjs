// Browser regressions share the same simulated Firebase/backend as the layout audit.
const assert=require('node:assert/strict');
const {run,server,EVIL,iso,job}=require('./ore-browser-fixtures.cjs');

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    await run('tecnico',{width:1366,height:900},'tecnico-desktop',async(page,calls)=>{
      // le schede riservate all'amministratore non devono comparire al tecnico
      for(const id of ['#tabAdmin','#tabArchive','#tabEconomics'])assert.equal(await page.locator(id).isVisible(),false,id+' visibile al tecnico');
      assert.ok((await page.locator('#dayTotal').innerText()).endsWith('/ 4h 00m'),'ore previste personalizzate');
      await page.evaluate(()=>renderMonthLock({monthClosed:true}));assert.equal(await page.locator('#confirmDay').isDisabled(),true);await page.evaluate(()=>renderMonthLock({monthClosed:false}));assert.equal(await page.locator('#confirmDay').isDisabled(),false);
      // testo del CRM mostrato come testo
      assert.ok((await page.locator('#sessions').innerText()).includes('<img src=x'),'il testo pericoloso deve apparire come testo');
      // 1h30 -> 90 minuti, Invio salva
      const inp=page.locator('#sessions .proto-hours input').first();
      await inp.fill('1h30');
      assert.ok(await page.locator('#sessions .proto-hour-row.dirty').count()===1,'riga modificata evidenziata');
      // tornare sulla scheda NON deve cancellare la modifica
      const before=calls.filter(c=>c.action==='day').length;
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(900);
      assert.equal(calls.filter(c=>c.action==='day').length,before,'ricarica fatta nonostante modifiche aperte');
      assert.equal(await inp.inputValue(),'1h30');
      await inp.press('Enter');
      await page.waitForTimeout(500);
      const save=calls.find(c=>c.action==='saveSession');
      assert.equal(save?.minutiEffettivi,90,'salvati 90 minuti');
      // formato errato: niente chiamata al server
      const n=calls.filter(c=>c.action==='saveSession').length;
      await page.locator('#sessions .proto-hours input').first().fill('2h75');
      await page.locator('#sessions .save').first().click();
      await page.waitForTimeout(300);
      assert.equal(calls.filter(c=>c.action==='saveSession').length,n);
      assert.ok(await page.locator('.toast-warn').count()>=1,'avviso formato');
      await page.locator('#sessions .proto-hours input').first().press('Escape');
      // conferma: chiede conferma per attività non abbinate, poi mostra errore leggibile del server
      page.once('dialog',d=>d.accept());
      await page.click('#confirmDay');
      await page.waitForTimeout(500);
      assert.ok((await page.locator('.toast-error').innerText()).includes('Giornata già chiusa'),'errore server leggibile');
      // cambio data veloce: la risposta lenta e vecchia non deve sovrascrivere
      await page.fill('#dayDate','2026-10-01');await page.dispatchEvent('#dayDate','change');
      await page.fill('#dayDate','2026-10-03');await page.dispatchEvent('#dayDate','change');
      await page.waitForTimeout(2000);
      assert.equal((await page.locator('#sessions').innerText()).includes('RISPOSTA VECCHIA'),false,'risposta vecchia mostrata');
      // anteprima durata nell'inserimento manuale
      await page.click('#manualToggle');await page.fill('#manualDuration','2:30');
      assert.equal(await page.locator('#manualCard .duration-preview').innerText(),'= 2h 30m');
      await page.fill('#manualDuration','');await page.click('#manualClose');
      assert.equal(await page.locator('#internalActivities .internal-entry').count(),2);
      await page.selectOption('#internalCategory','assenza');await page.fill('#internalDuration','2:30');
      assert.equal(await page.locator('#internalDurationPreview').innerText(),'= 2h 30m');
      await page.click('#saveInternal');await page.waitForTimeout(300);
      const internal=calls.find(c=>c.action==='saveInternal');assert.equal(internal.categoria,'assenza');assert.equal(internal.minutiEffettivi,150);assert.equal('motivo' in internal,false);
      assert.equal(await page.locator('#internalDuration').inputValue(),'');
      const phase=page.locator('#sessions .phase-select').first();
      assert.equal(await phase.inputValue(),'','nessuna deduzione dalla parola sopralluogo');
      await phase.selectOption('trasferta');assert.equal(calls.filter(c=>c.action==='savePhase').length,0,'fase non salvata senza conferma');
      await page.locator('#sessions .proto-hours input').first().fill('1h45');
      await page.locator('#sessions .save-phase').first().click();await page.waitForTimeout(250);
      assert.equal(calls.find(c=>c.action==='savePhase').fase,'trasferta');
      assert.equal(await page.locator('#sessions .proto-hours input').first().inputValue(),'1h45','salvare fase preserva ore aperte');
      assert.equal(await phase.inputValue(),'trasferta');
      await page.locator('#sessions .proto-hours input').first().press('Escape');
      await page.click('#missingPersonal [data-missing-date="2026-10-02"]');await page.waitForTimeout(250);
      await page.evaluate(()=>renderDayUnlock({date:'2026-10-02',dayStatus:{stato:'confermata'},sessions:[{confermata:true},{confermata:true}],internalActivities:[]}));
      assert.equal(await page.locator('#sessions .proto-hours input').first().isDisabled(),true);
      await page.fill('#dayUnlockRequest input','Correzione ore');await page.click('#dayUnlockRequest button');await page.waitForTimeout(250);assert.equal(calls.find(c=>c.action==='requestUnlock').date,'2026-10-02');
      assert.equal(await page.locator('#dayDate').inputValue(),'2026-10-02');assert.equal(calls.filter(c=>c.action==='day').at(-1).date,'2026-10-02');
    });
    await run('tecnico',{width:390,height:844},'tecnico-mobile',async(page)=>{
      for(const id of ['#tabAdmin','#tabArchive','#tabEconomics'])assert.equal(await page.locator(id).isVisible(),false,id+' visibile al tecnico (mobile)');
    });
    await run('admin',{width:1366,height:900},'admin-desktop',async(page,calls)=>{
      await page.click('#tabAdmin');await page.locator('#qualityPanel').evaluate(el=>el.open=true);await page.click('#loadDataQuality');await page.waitForSelector('#qualityGroups summary');await page.click('#qualityGroups summary');await page.click('[data-quality-link]');await page.waitForSelector('#qualityCaseDialog[open]');assert.ok((await page.locator('#qualityCaseContent').innerText()).includes('<img src=x'));assert.ok(page.url().includes('#quality/without_phase/quality-session'));await page.click('#qualityCaseClose');await page.click('[data-quality-link]');await page.waitForSelector('#qualityCaseDialog[open]');await page.click('#qualityCaseJob');await page.waitForSelector('#jobClosureForm');assert.ok(calls.some(c=>c.action==='archiveJobDetail'&&c.commessaId==='c1'));
      await page.click('#tabAdmin');await page.locator('#oreRolesPanel').evaluate(el=>el.open=true);await page.click('#loadOreRoles');await page.waitForSelector('[data-ore-role="u1"]');assert.equal(await page.locator('[data-ore-role="u1"]').inputValue(),'direzione');assert.ok((await page.locator('#oreRolesRows').innerText()).includes('<img src=x'));
      await page.click('#tabAdmin');await page.locator('#monthForm').evaluate(el=>el.closest('details').open=true);await page.fill('#monthForm [name="mese"]','2099-02');await page.click('#monthForm [value="reopen"]');assert.equal(calls.filter(c=>c.action==='changeMonth').length,0);await page.fill('#monthForm [name="motivo"]','Verifica sintetica');await page.click('#monthForm [value="close"]');await page.waitForTimeout(300);await page.click('#monthForm [value="reopen"]');await page.waitForTimeout(300);assert.deepEqual(calls.filter(c=>c.action==='changeMonth').map(c=>c.operation),['close','reopen']);assert.ok((await page.locator('#monthHistory').innerText()).includes('<img src=x'));
      for(const id of ['#tabAdmin','#tabArchive','#tabEconomics'])assert.equal(await page.locator(id).isVisible(),true,id+' non visibile all\'admin');
      await page.click('#tabAdmin');await page.waitForTimeout(800);
      assert.equal(await page.locator('#kpiBillable').innerText(),'80%');
      assert.match(await page.locator('.sync-failed').textContent(),/Lettura fallita: agenda_identica_sospetta/);
      await page.locator('.sync-failed').evaluate(el=>el.closest('details').open=true);
      assert.equal(await page.locator('.sync-failed').isVisible(),true);
      assert.match(await page.locator('#crmResourceRows').innerText(),/Attiva senza agenda CRM/);
      assert.equal(await page.locator('.sync-failed').count(),1,'VD manuale non è una lettura fallita');
      assert.equal(await page.locator('#crmSyncNever').textContent(),'1 mai','VD manuale esclusa dalle agende mancanti');
      assert.ok((await page.locator('#billabilityRows').innerText()).includes('80%'));
      await page.locator('#loadMissingDays').evaluate(el=>el.closest('details').open=true);await page.click('#loadMissingDays');await page.waitForTimeout(250);assert.match(await page.locator('#missingAdminRows').innerText(),/Non confermata/);assert.match(await page.locator('#missingAdminRows').innerText(),/Ore sotto il previsto/);
      await page.locator('#loadUnlockRequests').evaluate(el=>el.closest('details').open=true);await page.click('#loadUnlockRequests');await page.waitForSelector('[data-unlock-reason="unlock1"]');assert.match(await page.locator('#unlockRequestsRows tr td').first().innerText(),/Nome tecnico/);assert.ok(!(await page.locator('#unlockRequestsRows tr td').first().innerText()).includes('u1'));await page.fill('[data-unlock-reason="unlock1"]','Richiesta verificata');await page.click('[data-unlock-id="unlock1"][data-approve="true"]');await page.waitForTimeout(250);assert.equal(calls.find(c=>c.action==='decideUnlock').approve,true);
      await page.locator('#loadCompanyPeriods').evaluate(el=>el.closest('details').open=true);await page.click('#loadCompanyPeriods');await page.waitForSelector('[data-period-copy="period1"]');await page.click('[data-period-copy="period1"]');assert.equal(await page.inputValue('#companyPeriodForm [name="inizio"]'),'');assert.equal(await page.inputValue('#companyPeriodForm [data-company-week="4"]'),'4h 00m');await page.fill('#companyPeriodForm [name="inizio"]','2091-05-15');await page.fill('#companyPeriodForm [name="fine"]','2091-08-31');await page.click('#companyPeriodForm [type="submit"]');await page.waitForTimeout(250);assert.equal(calls.find(c=>c.action==='saveCompanyPeriod').id,null);assert.deepEqual(calls.find(c=>c.action==='saveCompanyPeriod').settimanaMinuti,[540,540,540,540,240,0,0]);
      const prod=await page.locator('#productivityRows').innerText();
      assert.match(prod,/B · DVR/);assert.match(prod,/30 h/,'mediana sullo storico (40 e 20) = 30 h');
      assert.ok(!prod.includes('99'),'pratiche aperte escluse');
      await page.selectOption('#productivityFilters [data-complexity="fascia_lavoratori"]','10-49');await page.waitForTimeout(250);
      assert.match(await page.locator('#productivityRows').innerText(),/40 h/);assert.match(await page.locator('#productivityRows').innerText(),/campione ridotto/);
      await page.selectOption('#productivityFilters [data-complexity="fascia_lavoratori"]','');
      await page.click('#tabEconomics');await page.waitForTimeout(300);await page.selectOption('#estimateType','B');
      assert.match(await page.locator('#estimateSample').innerText(),/2 casi/);
      await page.selectOption('#estimateComplexityFilters [data-complexity="fascia_lavoratori"]','10-49');await page.waitForTimeout(400);
      assert.match(await page.locator('#estimateSample').innerText(),/1 casi.*campione ridotto/);assert.equal(await page.locator('#estimateHours').inputValue(),'40');
      await page.click('#tabAdmin');
      await page.locator('#loadCrmLinks').evaluate(el=>el.closest('details').open=true);
      await page.click('#loadCrmLinks');
      await page.waitForSelector('#crmLinksRows .crm-target');
      assert.ok((await page.locator('#crmLinksRows').innerText()).includes('da confermare'));
      await page.selectOption('#crmLinksRows .crm-target','u2');await page.click('#crmLinksRows .crm-preview');
      await page.waitForSelector('#crmLinkPreview input');
      assert.equal(await page.locator('#crmLinkPreview input').isChecked(),false,'nessuna riassegnazione automatica');
      await page.check('#crmLinkPreview input');await page.click('#crmLinkPreview .crm-approve');
      await page.waitForTimeout(300);
      const approval=calls.find(c=>c.action==='approveCrmLink');
      assert.equal(approval.tecnicoUid,'u2');assert.equal(approval.sessions.length,1);assert.equal(approval.sessions[0].id,'move1');
      await page.selectOption('#crmLinksRows .crm-target','u2');await page.click('#crmLinksRows .identity-existing');await page.waitForSelector('.identity-check');
      assert.ok((await page.locator('#crmLinkPreview').innerText()).includes('12 sessioni'));
      await page.click('.identity-confirm');assert.equal(calls.filter(c=>c.action==='approveIdentity').length,0,'alias senza conferma rifiutato');
      await page.check('.identity-check');await page.click('.identity-confirm');await page.waitForTimeout(250);
      assert.equal(calls.find(c=>c.action==='approveIdentity').tecnicoUid,'u2');
      await page.click('#crmLinksRows .identity-new');await page.waitForSelector('#identityAccountForm');
      await page.fill('#identityAccountForm [name="nome"]','Nome');await page.fill('#identityAccountForm [name="cognome"]','Test');await page.fill('#identityAccountForm [name="username"]','nome.test');await page.fill('#identityAccountForm [name="password"]','Password-di-test-123');
      await page.check('.identity-check');await page.click('.identity-confirm');await page.waitForTimeout(300);
      const created=calls.filter(c=>c.action==='create');assert.equal(created.length,1);assert.equal(created[0].ruolo,'tecnico');assert.equal(calls.filter(c=>c.action==='approveIdentity').at(-1).tecnicoUid,'new-test-user');
      await page.locator('#loadWorkSchedules').evaluate(el=>el.closest('details').open=true);await page.click('#loadWorkSchedules');
      await page.selectOption('#workScheduleTech','u1');await page.fill('#workScheduleFrom','2026-11-01');
      for(let i=0;i<5;i++)await page.fill(`#workScheduleWeek input[data-weekday="${i}"]`,'4h');
      await page.click('#saveWorkSchedule');await page.waitForTimeout(300);
      const schedule=calls.find(c=>c.action==='saveWorkSchedule');assert.equal(schedule.validoDal,'2026-11-01');assert.deepEqual(schedule.settimanaMinuti,[240,240,240,240,240,0,0]);
      await page.click('#tabArchive');await page.waitForSelector('.archive-open');await page.locator('.archive-open').first().click();await page.waitForSelector('#jobClosureForm');
      await page.fill('#jobClosureForm [name="delivery"]','2026-10-01');await page.fill('#jobClosureForm [name="revisions"]','0');await page.click('#jobClosureForm button');await page.waitForTimeout(250);
      assert.equal(calls.find(c=>c.action==='changeJobState').revisioniCliente,0);
      await page.click('#jobClosureForm button');await page.waitForTimeout(250);assert.equal(calls.filter(c=>c.action==='changeJobState').at(-1).operation,'reopen');
      await page.fill('#jobComplexityForm [data-complexity="numero_sedi"]','2');await page.click('#jobComplexityForm button');await page.waitForTimeout(250);
      assert.equal(calls.find(c=>c.action==='saveJobComplexity').complexity.numero_sedi,2);assert.equal(calls.find(c=>c.action==='saveJobComplexity').complexity.numero_mansioni,null);
      await page.click('#tabAdmin');
      await page.fill('#adminFrom','2026-10-10');await page.fill('#adminTo','2026-10-01');await page.click('#loadAdmin');
      await page.waitForTimeout(200);
      assert.ok(await page.locator('.toast-warn').count()>=1,'periodo invertito segnalato');
    });
    await run('admin',{width:390,height:844},'admin-mobile',async(page)=>{
      await page.click('#tabAdmin');await page.waitForTimeout(800);
      assert.equal(await page.locator('#kpiBillable').innerText(),'80%');
      await page.click('#tabArchive');await page.waitForSelector('.archive-open');await page.locator('.archive-open').first().click();await page.waitForSelector('#jobClosureForm');
    });
    for(const viewport of [{width:1366,height:900},{width:390,height:844}])await run('admin_operativo',viewport,`operativo-${viewport.width}`,async(page,calls)=>{assert.equal(await page.locator('#tabAdmin').isVisible(),true);assert.equal(await page.locator('#tabArchive').isVisible(),true);assert.equal(await page.locator('#tabEconomics').isVisible(),false);assert.equal(await page.locator('#oreRolesPanel').isVisible(),false);await page.evaluate(()=>loadEconomics());assert.ok(!calls.some(c=>['adminEconomics','economicsCatalog'].includes(c.action)));});
    console.log('TUTTI I TEST BROWSER SUPERATI');
  }finally{server.close()}
})().catch(e=>{console.error('FALLITO:',e.message);server.close();process.exit(1)});
