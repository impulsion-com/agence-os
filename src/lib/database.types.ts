export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity: {
        Row: {
          actor_id: string | null
          created_at: string
          deal_id: string | null
          id: number
          meta: Json
          project_id: string | null
          task_id: string | null
          verb: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: never
          meta?: Json
          project_id?: string | null
          task_id?: string | null
          verb: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: never
          meta?: Json
          project_id?: string | null
          task_id?: string | null
          verb?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_accounts: {
        Row: {
          company_id: string | null
          connection_id: string | null
          created_at: string
          currency: string
          external_id: string
          id: string
          last_synced_at: string | null
          login_customer_id: string | null
          name: string
          platform: string
          sync_error: string | null
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          connection_id?: string | null
          created_at?: string
          currency?: string
          external_id: string
          id?: string
          last_synced_at?: string | null
          login_customer_id?: string | null
          name: string
          platform: string
          sync_error?: string | null
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          connection_id?: string | null
          created_at?: string
          currency?: string
          external_id?: string
          id?: string
          last_synced_at?: string | null
          login_customer_id?: string | null
          name?: string
          platform?: string
          sync_error?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "ad_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "ad_connections_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_connections: {
        Row: {
          access_token: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string
          platform: string
          refresh_token: string | null
          workspace_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string
          platform: string
          refresh_token?: string | null
          workspace_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string
          platform?: string
          refresh_token?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_metrics_daily: {
        Row: {
          ad_account_id: string
          campaign_id: string
          campaign_name: string
          clicks: number
          conversion_value: number
          conversions: number
          date: string
          impressions: number
          spend: number
          workspace_id: string
        }
        Insert: {
          ad_account_id: string
          campaign_id: string
          campaign_name?: string
          clicks?: number
          conversion_value?: number
          conversions?: number
          date: string
          impressions?: number
          spend?: number
          workspace_id: string
        }
        Update: {
          ad_account_id?: string
          campaign_id?: string
          campaign_name?: string
          clicks?: number
          conversion_value?: number
          conversions?: number
          date?: string
          impressions?: number
          spend?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_daily_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_metrics_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          id: string
          mime: string
          name: string
          path: string
          project_id: string | null
          size: number
          task_id: string | null
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime?: string
          name: string
          path: string
          project_id?: string | null
          size?: number
          task_id?: string | null
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mime?: string
          name?: string
          path?: string
          project_id?: string | null
          size?: number
          task_id?: string | null
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          edited_at: string | null
          id: string
          task_id: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          task_id: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          task_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          color: string
          created_at: string
          id: string
          industry: string
          monthly_retainer: number | null
          name: string
          notes: string
          owner_id: string | null
          status: string
          website: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          industry?: string
          monthly_retainer?: number | null
          name: string
          notes?: string
          owner_id?: string | null
          status?: string
          website?: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          industry?: string
          monthly_retainer?: number | null
          name?: string
          notes?: string
          owner_id?: string | null
          status?: string
          website?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          job_title: string
          last_name: string
          notes: string
          phone: string
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          job_title?: string
          last_name?: string
          notes?: string
          phone?: string
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          job_title?: string
          last_name?: string
          notes?: string
          phone?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          author_id: string | null
          body: string
          company_id: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          done: boolean
          due_at: string | null
          id: string
          kind: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          done?: boolean
          due_at?: string | null
          id?: string
          kind?: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          done?: boolean
          due_at?: string | null
          id?: string
          kind?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          billing: string
          closed_at: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          expected_close: string | null
          id: string
          lost_reason: string
          owner_id: string | null
          position: number
          services: string[]
          source: string
          stage_id: string | null
          title: string
          value: number
          workspace_id: string
        }
        Insert: {
          billing?: string
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          expected_close?: string | null
          id?: string
          lost_reason?: string
          owner_id?: string | null
          position?: number
          services?: string[]
          source?: string
          stage_id?: string | null
          title: string
          value?: number
          workspace_id: string
        }
        Update: {
          billing?: string
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          expected_close?: string | null
          id?: string
          lost_reason?: string
          owner_id?: string | null
          position?: number
          services?: string[]
          source?: string
          stage_id?: string | null
          title?: string
          value?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          team_id: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          team_id?: string | null
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          team_id?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_targets: {
        Row: {
          company_id: string
          id: string
          metric: string
          target: number
          workspace_id: string
        }
        Insert: {
          company_id: string
          id?: string
          metric: string
          target: number
          workspace_id: string
        }
        Update: {
          company_id?: string
          id?: string
          metric?: string
          target?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_targets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          archived_at: string | null
          body: string
          created_at: string
          deal_id: string | null
          id: string
          kind: string
          project_id: string | null
          proposal_id: string | null
          read_at: string | null
          task_id: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          archived_at?: string | null
          body?: string
          created_at?: string
          deal_id?: string | null
          id?: string
          kind: string
          project_id?: string | null
          proposal_id?: string | null
          read_at?: string | null
          task_id?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          archived_at?: string | null
          body?: string
          created_at?: string
          deal_id?: string | null
          id?: string
          kind?: string
          project_id?: string | null
          proposal_id?: string | null
          read_at?: string | null
          task_id?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          id: string
          kind: string
          name: string
          position: number
          probability: number
          workspace_id: string
        }
        Insert: {
          color?: string
          id?: string
          kind?: string
          name: string
          position?: number
          probability?: number
          workspace_id: string
        }
        Update: {
          color?: string
          id?: string
          kind?: string
          name?: string
          position?: number
          probability?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          color: string
          created_at: string
          email: string
          full_name: string
          id: string
          prefs: Json
          title: string
        }
        Insert: {
          color?: string
          created_at?: string
          email: string
          full_name?: string
          id: string
          prefs?: Json
          title?: string
        }
        Update: {
          color?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          prefs?: Json
          title?: string
        }
        Relationships: []
      }
      project_favorites: {
        Row: {
          position: number
          project_id: string
          user_id: string
        }
        Insert: {
          position?: number
          project_id: string
          user_id?: string
        }
        Update: {
          position?: number
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_favorites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          project_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          color: string
          company_id: string | null
          created_at: string
          description: string
          due_date: string | null
          icon: string
          id: string
          key: string
          lead_id: string | null
          monthly_budget: number | null
          name: string
          platforms: string[]
          seq: number
          start_date: string | null
          status: string
          team_id: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          color?: string
          company_id?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          icon?: string
          id?: string
          key: string
          lead_id?: string | null
          monthly_budget?: number | null
          name: string
          platforms?: string[]
          seq?: number
          start_date?: string | null
          status?: string
          team_id?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          color?: string
          company_id?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          icon?: string
          id?: string
          key?: string
          lead_id?: string | null
          monthly_budget?: number | null
          name?: string
          platforms?: string[]
          seq?: number
          start_date?: string | null
          status?: string
          team_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_items: {
        Row: {
          billing: string
          description: string
          id: string
          name: string
          optional: boolean
          position: number
          proposal_id: string
          quantity: number
          selected: boolean
          service_id: string | null
          unit_price: number
        }
        Insert: {
          billing?: string
          description?: string
          id?: string
          name: string
          optional?: boolean
          position?: number
          proposal_id: string
          quantity?: number
          selected?: boolean
          service_id?: string | null
          unit_price?: number
        }
        Update: {
          billing?: string
          description?: string
          id?: string
          name?: string
          optional?: boolean
          position?: number
          proposal_id?: string
          quantity?: number
          selected?: boolean
          service_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposal_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          accepted_at: string | null
          accepted_name: string | null
          blocks: Json
          company_id: string | null
          contact_id: string | null
          created_at: string
          currency: string
          deal_id: string | null
          declined_reason: string | null
          discount_pct: number
          id: string
          number: number
          owner_id: string | null
          public_token: string
          sent_at: string | null
          status: string
          tax_pct: number
          title: string
          updated_at: string
          valid_until: string | null
          viewed_at: string | null
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_name?: string | null
          blocks?: Json
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          declined_reason?: string | null
          discount_pct?: number
          id?: string
          number: number
          owner_id?: string | null
          public_token?: string
          sent_at?: string | null
          status?: string
          tax_pct?: number
          title: string
          updated_at?: string
          valid_until?: string | null
          viewed_at?: string | null
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_name?: string | null
          blocks?: Json
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          declined_reason?: string | null
          discount_pct?: number
          id?: string
          number?: number
          owner_id?: string | null
          public_token?: string
          sent_at?: string | null
          status?: string
          tax_pct?: number
          title?: string
          updated_at?: string
          valid_until?: string | null
          viewed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          commentary: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          next_steps: string
          period_end: string
          period_start: string
          public_token: string
          shared: boolean
          title: string
          workspace_id: string
        }
        Insert: {
          commentary?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          next_steps?: string
          period_end: string
          period_start: string
          public_token?: string
          shared?: boolean
          title: string
          workspace_id: string
        }
        Update: {
          commentary?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          next_steps?: string
          period_end?: string
          period_start?: string
          public_token?: string
          shared?: boolean
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          icon: string
          id: string
          name: string
          project_id: string | null
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          name: string
          project_id?: string | null
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          name?: string
          project_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          archived: boolean
          billing: string
          description: string
          id: string
          name: string
          position: number
          unit_price: number
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          billing?: string
          description?: string
          id?: string
          name: string
          position?: number
          unit_price?: number
          workspace_id: string
        }
        Update: {
          archived?: boolean
          billing?: string
          description?: string
          id?: string
          name?: string
          position?: number
          unit_price?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subtasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          done: boolean
          id: string
          position: number
          task_id: string
          title: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          done?: boolean
          id?: string
          position?: number
          task_id: string
          title: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          done?: boolean
          id?: string
          position?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          depends_on_id: string
          task_id: string
        }
        Insert: {
          depends_on_id: string
          task_id: string
        }
        Update: {
          depends_on_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_id_fkey"
            columns: ["depends_on_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_labels: {
        Row: {
          label_id: string
          task_id: string
        }
        Insert: {
          label_id: string
          task_id: string
        }
        Update: {
          label_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_labels_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          id: string
          milestone: boolean
          number: number
          position: number
          priority: string
          project_id: string
          recurrence: string | null
          start_date: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          milestone?: boolean
          number: number
          position?: number
          priority?: string
          project_id: string
          recurrence?: string | null
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          milestone?: boolean
          number?: number
          position?: number
          priority?: string
          project_id?: string
          recurrence?: string | null
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string
          created_at: string
          description: string
          icon: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          joined_at: string
          role: Database["public"]["Enums"]["member_role"]
          team_id: string | null
          title: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          team_id?: string | null
          title?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          team_id?: string | null
          title?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          accent: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          accent?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          accent?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      ad_connections_public: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string | null
          label: string | null
          platform: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          label?: string | null
          platform?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          label?: string | null
          platform?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      can_write: { Args: { ws: string }; Returns: boolean }
      clear_demo_data: { Args: { ws: string }; Returns: undefined }
      create_workspace: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      demo_task: {
        Args: {
          descr?: string
          due_off: number
          labs?: string[]
          p: string
          prio: string
          st: string
          start_off: number
          subs?: string[]
          subs_done?: number
          title: string
          who: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          roles: Database["public"]["Enums"]["member_role"][]
          ws: string
        }
        Returns: boolean
      }
      is_admin: { Args: { ws: string }; Returns: boolean }
      is_member: { Args: { ws: string }; Returns: boolean }
      load_demo_data: { Args: { ws: string }; Returns: undefined }
      project_ws: { Args: { p: string }; Returns: string }
      proposal_ws: { Args: { p: string }; Returns: string }
      public_proposal: { Args: { p_token: string }; Returns: Json }
      public_report: { Args: { p_token: string }; Returns: Json }
      respond_proposal: {
        Args: {
          p_accept: boolean
          p_name: string
          p_reason: string
          p_selected: string[]
          p_token: string
        }
        Returns: undefined
      }
      seed_workspace_defaults: { Args: { ws: string }; Returns: undefined }
      shares_workspace: { Args: { other: string }; Returns: boolean }
      task_ws: { Args: { t: string }; Returns: string }
    }
    Enums: {
      member_role: "owner" | "admin" | "member" | "guest"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      member_role: ["owner", "admin", "member", "guest"],
    },
  },
} as const
