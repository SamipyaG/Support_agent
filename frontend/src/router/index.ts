import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '@/views/DashboardView.vue';
import IncidentDetailView from '@/views/IncidentDetailView.vue';
import MonitoringView from '@/views/MonitoringView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/incidents/:id', name: 'incident-detail', component: IncidentDetailView },
    { path: '/monitoring', name: 'monitoring', component: MonitoringView },
  ],
});

export default router;
