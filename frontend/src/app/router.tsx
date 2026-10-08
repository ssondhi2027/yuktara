import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { ClientShell } from '@/components/layout/ClientShell'
import { CoachShell } from '@/components/layout/CoachShell'
import { PageLoading } from '@/components/ui/Loading'
import { ClientHomePage } from '@/features/client/home/HomePage'
import { FoodPage } from '@/features/client/food/FoodPage'
import { CheckinPage } from '@/features/client/checkin/CheckinPage'
import { CheckinSummaryPage } from '@/features/client/checkin/CheckinSummaryPage'
import { MessagesPage } from '@/features/client/messages/MessagesPage'
import { CoachMessagesPage } from '@/features/coach/messages/CoachMessagesPage'
import { ProgressPage } from '@/features/client/progress/ProgressPage'
import { CoachDashboardPage } from '@/features/coach/dashboard/DashboardPage'
import { CheckinsPage } from '@/features/coach/review/CheckinsPage'
import { AuthPage } from '@/features/auth/AuthPage'
import { RequireAuth } from './auth'
import { ComingSoon } from './ComingSoon'

// three.js is ~600 kB; only the Train tab pays for it.
const TrainPage = lazy(() => import('@/features/client/train/TrainPage'))
const WorkoutPage = lazy(() => import('@/features/client/train/WorkoutPage'))

export const router = createBrowserRouter([
  // The app opens here when nobody is signed in.
  { path: '/login', element: <AuthPage /> },
  {
    path: '/',
    element: <RequireAuth role="client"><ClientShell /></RequireAuth>,
    children: [
      { index: true, element: <ClientHomePage /> },
      { path: 'train', element: <Suspense fallback={<PageLoading />}><TrainPage /></Suspense> },
      { path: 'train/workout/:id', element: <Suspense fallback={<PageLoading />}><WorkoutPage /></Suspense> },
      { path: 'food', element: <FoodPage /> },
      { path: 'check-in', element: <CheckinPage /> },
      { path: 'check-in/:id', element: <CheckinSummaryPage /> },
      { path: 'progress', element: <ProgressPage /> },
      { path: 'messages', element: <MessagesPage /> },
    ],
  },
  {
    path: '/coach',
    element: <RequireAuth role="coach"><CoachShell /></RequireAuth>,
    children: [
      { index: true, element: <CoachDashboardPage /> },
      { path: 'check-ins', element: <CheckinsPage /> },
      { path: 'check-ins/:id', element: <CheckinsPage /> },
      { path: 'clients', element: <ComingSoon title="Clients" text="Every client, their program, targets and history." /> },
      { path: 'programs', element: <ComingSoon title="Programs" text="Build templates and assign workouts week by week." /> },
      { path: 'nutrition', element: <ComingSoon title="Nutrition plans" text="Calorie and macro targets, versioned by start date." /> },
      { path: 'messages', element: <CoachMessagesPage /> },
      { path: 'messages/:clientId', element: <CoachMessagesPage /> },
      { path: 'settings', element: <ComingSoon title="Settings" text="Check-in questions, reminders and your profile." /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
