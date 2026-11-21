import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'workspace' },
  { path: 'workspace', children: [] },
  { path: 'prototype/workspace', redirectTo: 'workspace' },
  { path: '**', redirectTo: 'workspace' },
];
