import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import OpsPreviewForm from '../components/OpsPreviewForm';
import {useStore} from '../store';
import type {ToonOperation} from '../types';

const ops:ToonOperation[]=[{type:'create_entity',payload:{kind:'TASK',title:'Prepare the meeting'}}];
const originalConfirm=useStore.getState().confirmPlan;
afterEach(()=>{cleanup();useStore.setState({confirmPlan:originalConfirm});});
beforeEach(()=>{useStore.setState({kernelEntities:{},entities:[],relationships:[],currentUser:null});});
describe('Action review trust and editing',()=>{
 it('preserves structured coordinates when reviewing an event venue label',async()=>{
  const execute=vi.fn().mockResolvedValue(true);
  const eventOps:ToonOperation[]=[{type:'create_entity',payload:{kind:'EVENT',title:'Team review',start_time:'2026-10-12T10:00:00Z',end_time:'2026-10-12T11:00:00Z',metadata:{location:{lat:20.354,lng:85.827,address:'Old venue'}}}}];
  render(<OpsPreviewForm ops={eventOps} onConfirm={execute} onCancel={()=>{}}/>);
  expect(screen.getByLabelText('Location')).toHaveValue('Old venue');
  fireEvent.change(screen.getByLabelText('Location'),{target:{value:'Room A'}});
  fireEvent.click(screen.getByRole('button',{name:'Apply (1)'}));
  await waitFor(()=>expect(execute).toHaveBeenCalledTimes(1));
  const mutation=execute.mock.calls[0][0].plan.validated_mutations[0];
  expect(mutation.entity.attributes.location).toEqual({lat:20.354,lng:85.827,address:'Room A'});
 });

 it('assigns distinct identities to successive voice proposals from the same message',()=>{
  useStore.getState().setPendingOps(ops,'same-message');const first=useStore.getState().pendingOps;
  useStore.getState().setPendingOps([{type:'create_entity',payload:{kind:'TASK',title:'New voice request'}}],'same-message');
  expect(useStore.getState().pendingOps?.reviewId).not.toBe(first?.reviewId);
 });
 it('keeps the same focused field while editing and binds confirmation to the edited value',async()=>{
  const execute=vi.fn().mockResolvedValue(true);
  render(<OpsPreviewForm ops={ops} onConfirm={execute} onCancel={()=>{}}/>);
  const input=screen.getByLabelText('Title');input.focus();
  fireEvent.change(input,{target:{value:'Prepare the meeting tomorrow'}});
  expect(screen.getByLabelText('Title')).toBe(input);expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button',{name:'Apply (1)'}));
  await waitFor(()=>expect(execute).toHaveBeenCalledTimes(1));
  expect(JSON.stringify(execute.mock.calls[0][0].plan.validated_mutations)).toContain('Prepare the meeting tomorrow');
 });
 it('blocks unsupported operations without invoking execution',()=>{
  const execute=vi.fn();
  render(<OpsPreviewForm ops={[{type:'unsupported_action' as ToonOperation['type'],payload:{}}]} onConfirm={execute} onCancel={()=>{}}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('cannot be applied');
  expect(screen.getByRole('button',{name:'Apply (1)'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Apply (1)'}));expect(execute).not.toHaveBeenCalled();
 });
 it('does not fall back to raw operations when confirmation fails',async()=>{
  useStore.setState({confirmPlan:()=>{throw new Error('fingerprint mismatch');}});
  const execute=vi.fn();
  render(<OpsPreviewForm ops={ops} onConfirm={execute} onCancel={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Apply (1)'}));
  await screen.findByRole('alert');expect(execute).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Title')).toHaveValue('Prepare the meeting');
 });
 it('retains failed edits and prevents concurrent executions and cancellation',async()=>{
  let finish!:(value:boolean)=>void;const execute=vi.fn(()=>new Promise<boolean>(resolve=>finish=resolve));const cancel=vi.fn();
  render(<OpsPreviewForm ops={ops} onConfirm={execute} onCancel={cancel}/>);
  fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Keep this edit'}});
  const apply=screen.getByRole('button',{name:'Apply (1)'});fireEvent.click(apply);fireEvent.click(apply);
  expect(execute).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(cancel).not.toHaveBeenCalled();
  finish(false);await screen.findByRole('alert');
  expect(screen.getByLabelText('Title')).toHaveValue('Keep this edit');expect(screen.getByRole('button',{name:'Apply (1)'})).toBeEnabled();
 });
 it('supports a labelled modal and keyboard cancellation',()=>{
  const cancel=vi.fn();render(<OpsPreviewForm ops={ops} onConfirm={vi.fn()} onCancel={cancel}/>);
  const dialog=screen.getByRole('dialog');expect(dialog).toHaveAttribute('aria-modal','true');
  fireEvent.keyDown(dialog,{key:'Escape'});expect(cancel).toHaveBeenCalledTimes(1);
 });

 it('persists review drafts across unexpected unmount and recovers them after revalidation',async()=>{
  const execute=vi.fn().mockResolvedValue(true);
  const {unmount}=render(<OpsPreviewForm ops={ops} onConfirm={execute} onCancel={()=>{}}/>);
  const input=screen.getByLabelText('Title');
  fireEvent.change(input,{target:{value:'Prepare executive briefing'}});
  await waitFor(async()=>{
    const {getLatestReviewDraft}=await import('../services/action-review');
    const draft=await getLatestReviewDraft();
    expect(draft).not.toBeNull();
    expect(draft?.ops[0]?.payload?.title).toBe('Prepare executive briefing');
  });
  unmount();
  const {getLatestReviewDraft, revalidateReviewDraft}=await import('../services/action-review');
  const recovered=await getLatestReviewDraft();
  expect(recovered).not.toBeNull();
  expect(recovered?.ops[0]?.payload?.title).toBe('Prepare executive briefing');
  const validation=revalidateReviewDraft(recovered!, useStore.getState().kernelEntities);
  expect(validation.isValid).toBe(true);
 });
});
