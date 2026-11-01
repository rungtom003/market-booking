# ผล benchmark รายงาน (Phase 8)

> `pnpm bench:reports` — 2026-11-01 · เกณฑ์ < 2000 ms ต่อรายงาน (เวลาที่ช้าสุดจาก 3 รอบหลัง warm-up)

ข้อมูลจำลอง 1 ปี (2025-11-08 → 2026-11-01): market_days 104 · vendors 1,500 · payments 28,532 · bookings 32,405 · audit_logs 194,442 · ล็อค 300

| รายงาน | เวลา (ms) | แถว | ผล |
|---|--:|--:|:-:|
| dashboard | 8 | 1 | ✅ |
| revenue by day (1 ปี) | 34 | 104 | ✅ |
| revenue by round | 37 | 52 | ✅ |
| revenue by zone | 32 | 4 | ✅ |
| occupancy by day | 25 | 104 | ✅ |
| occupancy by zone | 23 | 4 | ✅ |
| vendors top (bookings) | 17 | 50 | ✅ |
| vendors top (noshow, 500) | 15 | 67 | ✅ |
| audit log: หน้าแรก (ไม่กรอง) | 12 | 20 | ✅ |
| audit log: action + ช่วง 1 เดือน | 5 | 20 | ✅ |
| audit log: action หายาก ทั้งปี | 10 | 12 | ✅ |
| audit log: หน้าลึก (page 500) | 16 | 50 | ✅ |
| audit log: รายการ action | 12 | 7 | ✅ |

## Query plan (EXPLAIN ANALYZE)

### dashboard

```
Limit  (cost=2.18..2.19 rows=1 width=97) (actual rows=0 loops=1)
  ->  Sort  (cost=2.18..2.19 rows=1 width=97) (actual rows=0 loops=1)
        Sort Key: open_at
        Sort Method: quicksort  Memory: 25kB
        ->  Seq Scan on booking_rounds  (cost=0.00..2.17 rows=1 width=97) (actual rows=0 loops=1)
              Filter: ((close_at > '2026-11-01 07:36:27.882+00'::timestamp with time zone) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid) AND (status = ('PUBLISHED'::cstring)::"RoundStatus"))
              Rows Removed by Filter: 52
Planning Time: 0.239 ms
Execution Time: 0.027 ms
```

```
Aggregate  (cost=9.48..9.49 rows=1 width=8) (actual rows=1 loops=1)
  ->  Index Only Scan using vendors_market_id_status_created_at_idx on vendors  (cost=0.28..9.02 rows=37 width=16) (actual rows=37 loops=1)
        Index Cond: ((market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid) AND (status = ('PENDING'::cstring)::"VendorStatus"))
        Heap Fetches: 1
Planning Time: 0.279 ms
Execution Time: 0.027 ms
```

```
Aggregate  (cost=14.38..14.39 rows=1 width=8) (actual rows=1 loops=1)
  ->  Nested Loop  (cost=0.58..14.37 rows=1 width=16) (actual rows=0 loops=1)
        ->  Index Scan using payments_status_created_at_idx on payments  (cost=0.29..6.06 rows=1 width=16) (actual rows=0 loops=1)
              Index Cond: (status = ('PENDING'::cstring)::"PaymentStatus")
        ->  Index Scan using bookings_pkey on bookings j0  (cost=0.29..8.31 rows=1 width=16) (never executed)
              Index Cond: ((id = payments.booking_id) AND (id IS NOT NULL))
              Filter: (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid)
Planning Time: 0.150 ms
Execution Time: 0.023 ms
```

### revenue by day (1 ปี)

```
GroupAggregate  (cost=4459.76..4981.72 rows=104 width=132) (actual rows=104 loops=1)
  Group Key: ((md.market_date)::text)
  ->  Sort  (cost=4459.76..4524.68 rows=25968 width=66) (actual rows=25968 loops=1)
        Sort Key: ((md.market_date)::text), p.booking_id
        Sort Method: quicksort  Memory: 2554kB
        ->  Hash Join  (cost=1433.98..2555.73 rows=25968 width=66) (actual rows=25968 loops=1)
              Hash Cond: (b.stall_id = s.id)
              ->  Hash Join  (cost=1421.23..2344.01 rows=25968 width=54) (actual rows=25968 loops=1)
                    Hash Cond: (b.market_day_id = md.id)
                    ->  Hash Join  (cost=1416.11..2267.94 rows=25968 width=66) (actual rows=25968 loops=1)
                          Hash Cond: (p.booking_id = b.id)
                          ->  Seq Scan on payments p  (cost=0.00..783.65 rows=25968 width=34) (actual rows=25968 loops=1)
                                Filter: (status = 'APPROVED'::"PaymentStatus")
                                Rows Removed by Filter: 2564
                          ->  Hash  (cost=1011.05..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                                Buckets: 32768  Batches: 1  Memory Usage: 2788kB
                                ->  Seq Scan on bookings b  (cost=0.00..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                    ->  Hash  (cost=3.82..3.82 rows=104 width=20) (actual rows=104 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 14kB
                          ->  Seq Scan on market_days md  (cost=0.00..3.82 rows=104 width=20) (actual rows=104 loops=1)
                                Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
              ->  Hash  (cost=9.00..9.00 rows=300 width=16) (actual rows=300 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 23kB
                    ->  Seq Scan on stalls s  (cost=0.00..9.00 rows=300 width=16) (actual rows=300 loops=1)
Planning Time: 0.448 ms
Execution Time: 27.554 ms
```

### revenue by round

```
GroupAggregate  (cost=4459.76..4980.42 rows=52 width=132) (actual rows=52 loops=1)
  Group Key: ((md.round_id)::text)
  ->  Sort  (cost=4459.76..4524.68 rows=25968 width=66) (actual rows=25968 loops=1)
        Sort Key: ((md.round_id)::text), p.booking_id
        Sort Method: quicksort  Memory: 3325kB
        ->  Hash Join  (cost=1433.98..2555.73 rows=25968 width=66) (actual rows=25968 loops=1)
              Hash Cond: (b.stall_id = s.id)
              ->  Hash Join  (cost=1421.23..2344.01 rows=25968 width=66) (actual rows=25968 loops=1)
                    Hash Cond: (b.market_day_id = md.id)
                    ->  Hash Join  (cost=1416.11..2267.94 rows=25968 width=66) (actual rows=25968 loops=1)
                          Hash Cond: (p.booking_id = b.id)
                          ->  Seq Scan on payments p  (cost=0.00..783.65 rows=25968 width=34) (actual rows=25968 loops=1)
                                Filter: (status = 'APPROVED'::"PaymentStatus")
                                Rows Removed by Filter: 2564
                          ->  Hash  (cost=1011.05..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                                Buckets: 32768  Batches: 1  Memory Usage: 2788kB
                                ->  Seq Scan on bookings b  (cost=0.00..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                    ->  Hash  (cost=3.82..3.82 rows=104 width=32) (actual rows=104 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 15kB
                          ->  Seq Scan on market_days md  (cost=0.00..3.82 rows=104 width=32) (actual rows=104 loops=1)
                                Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
              ->  Hash  (cost=9.00..9.00 rows=300 width=16) (actual rows=300 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 23kB
                    ->  Seq Scan on stalls s  (cost=0.00..9.00 rows=300 width=16) (actual rows=300 loops=1)
Planning Time: 0.368 ms
Execution Time: 28.343 ms
```

```
Seq Scan on booking_rounds  (cost=0.13..1.91 rows=33 width=57) (actual rows=52 loops=1)
  Filter: (id = ANY ('{05704058-d500-4597-b29b-690b0911d850,0ade9ca7-7115-482d-9808-bf54dcdb265e,0f65b958-52cf-4e01-9674-af43acec773b,0f8e5003-4e0c-4a99-b135-0d4919ae618e,13819487-dcb9-4080-9c8d-b233fc32f315,1832109d-4f3e-4252-8649-463fd1c2af29,18d3a0bb-40cf-4b41-a3aa-86a582869f17,1a038381-6d49-4089-a1dc-84f199af189e,1f205a7a-f07b-4b1c-9840-0e8e41f91675,29ae54a7-1e45-427f-b195-0c6e09c1a964,33ea8579-d5e4-4506-b16f-71d892ebc6d2,359dd4c5-0b85-4655-b8d5-429ba0962377,37bbc203-f4d0-4c4f-8ce3-2c7466c678fd,37e80bb0-1093-461e-8221-295a9ec4a1b5,432f7a97-657c-49b2-b33b-0741ce7d6103,4d9caa5b-5d66-49ba-af77-60050ab0b0d2,4f3f1c77-f402-4f59-8afe-5c901fea64ca,527c5648-02f3-4c6c-b1fc-5ae0e57a11d9,53bf13cd-3fa9-4fbc-a49d-01cc932e622f,5567afef-896f-4789-801d-ab9767407574,63192a2e-fcf2-4d34-9f90-8129b648061f,67729975-571c-4fa1-9c25-9149ffd87843,6c910e4b-89c5-4672-a696-1bb09ed448c0,6f751962-f405-4ae0-b448-f3f1a19d1c60,7c3039be-619c-4840-8444-8cf38ef372c7,7c90f890-a963-4ddf-8b8d-18a42fe18525,8bb080c3-b882-48cc-866a-43dbd9203d1a,8c5df49c-37ec-4560-853f-16bd1f8d75b8,93669837-206b-4b13-aad8-64783ab1b08e,a98a102e-2067-42e2-80d5-6ccd8c3b3efc,a9aed556-1131-4271-8a73-d027dffe9fd7,ad5c167b-51c7-4987-b6d5-2cd66d706750,adb53b3c-c736-4a21-8fe9-e1eecebbeb81,ae5e6198-ef0b-4728-b774-dc65eb6d7ed7,b9cb80f2-e902-487c-a52a-09ef3370fd3b,bedc8c73-4977-494d-8b94-2d5437a07cf0,c55c1eed-3117-4cfb-b879-b5b5d1019b75,c7c38963-bce5-4710-bc7a-983247d4288f,c910127b-2532-42f6-a915-d04e711dbf11,ce00c770-d952-4144-bdfe-ce22e6fab36d,d0c67cd4-e79e-4068-8581-9a226901847b,d23c0947-123d-4a78-abd3-cf0c4310cb76,e6c95fd4-dbae-4afa-8f92-36818629a99e,e7f6ea82-90d2-4160-ac2b-fa542bcb3c8f,e9a4b243-0fc0-47a6-96ad-322ba4cf4d72,eb1164f0-2a1f-451a-b3d3-b43c3076203e,f3379e94-f9df-43d5-a5f9-72cabb8ad004,f639b922-2f99-4705-9c70-8062f23c80e9,f82558fa-8501-45e0-a5ee-a29170c7c61e,fb712c9f-d5ec-41b9-96e6-a440ec853513,fbd8028d-068b-4e85-a6c4-6a5044047949,fcb92d28-504c-4663-b25a-a27798a01799}'::uuid[]))
Planning Time: 0.066 ms
Execution Time: 0.017 ms
```

### revenue by zone

```
GroupAggregate  (cost=4459.76..4979.22 rows=4 width=132) (actual rows=4 loops=1)
  Group Key: ((s.zone_id)::text)
  ->  Sort  (cost=4459.76..4524.68 rows=25968 width=66) (actual rows=25968 loops=1)
        Sort Key: ((s.zone_id)::text), p.booking_id
        Sort Method: quicksort  Memory: 3325kB
        ->  Hash Join  (cost=1433.98..2555.73 rows=25968 width=66) (actual rows=25968 loops=1)
              Hash Cond: (b.stall_id = s.id)
              ->  Hash Join  (cost=1421.23..2344.01 rows=25968 width=50) (actual rows=25968 loops=1)
                    Hash Cond: (b.market_day_id = md.id)
                    ->  Hash Join  (cost=1416.11..2267.94 rows=25968 width=66) (actual rows=25968 loops=1)
                          Hash Cond: (p.booking_id = b.id)
                          ->  Seq Scan on payments p  (cost=0.00..783.65 rows=25968 width=34) (actual rows=25968 loops=1)
                                Filter: (status = 'APPROVED'::"PaymentStatus")
                                Rows Removed by Filter: 2564
                          ->  Hash  (cost=1011.05..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                                Buckets: 32768  Batches: 1  Memory Usage: 2788kB
                                ->  Seq Scan on bookings b  (cost=0.00..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                    ->  Hash  (cost=3.82..3.82 rows=104 width=16) (actual rows=104 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 13kB
                          ->  Seq Scan on market_days md  (cost=0.00..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
              ->  Hash  (cost=9.00..9.00 rows=300 width=32) (actual rows=300 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 27kB
                    ->  Seq Scan on stalls s  (cost=0.00..9.00 rows=300 width=32) (actual rows=300 loops=1)
Planning Time: 0.606 ms
Execution Time: 29.001 ms
```

```
Seq Scan on zones  (cost=0.00..1.06 rows=4 width=32) (actual rows=4 loops=1)
  Filter: (id = ANY ('{41cda0a7-9723-4d2e-ba8f-6d808903f844,4b5ea35c-059b-4736-ba4d-5614b9f17500,ce398d97-be03-4eb0-ba9a-0b65887c992d,ef5a3f84-d89c-4b1a-a289-736bff70cfc3}'::uuid[]))
Planning Time: 0.038 ms
Execution Time: 0.009 ms
```

### occupancy by day

```
HashAggregate  (cost=2965.17..2967.51 rows=104 width=44) (actual rows=104 loops=1)
  Group Key: (d.market_date)::text
  Batches: 1  Memory Usage: 32kB
  CTE d
    ->  Seq Scan on market_days md  (cost=0.00..3.82 rows=104 width=20) (actual rows=104 loops=1)
          Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
  ->  Hash Left Join  (cost=2095.51..2808.47 rows=15288 width=34) (actual rows=29968 loops=1)
        Hash Cond: ((d_1.id = bk.day_id) AND (s.id = bk.stall_id))
        ->  Hash Left Join  (cost=26.86..583.11 rows=15288 width=36) (actual rows=29968 loops=1)
              Hash Cond: ((s.id = o.stall_id) AND (d_1.id = o.market_day_id))
              Filter: (NOT COALESCE(o.is_closed, false))
              Rows Removed by Filter: 608
              ->  Nested Loop  (cost=3.38..399.10 rows=30576 width=36) (actual rows=30576 loops=1)
                    ->  Seq Scan on stalls s  (cost=0.00..9.75 rows=294 width=16) (actual rows=294 loops=1)
                          Filter: (is_active AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
                          Rows Removed by Filter: 6
                    ->  Materialize  (cost=3.38..7.41 rows=104 width=20) (actual rows=104 loops=294)
                          ->  Hash Join  (cost=3.38..6.89 rows=104 width=20) (actual rows=104 loops=1)
                                Hash Cond: (d_1.id = d.id)
                                ->  CTE Scan on d d_1  (cost=0.00..2.08 rows=104 width=16) (actual rows=104 loops=1)
                                ->  Hash  (cost=2.08..2.08 rows=104 width=20) (actual rows=104 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 14kB
                                      ->  CTE Scan on d  (cost=0.00..2.08 rows=104 width=20) (actual rows=104 loops=1)
              ->  Hash  (cost=14.19..14.19 rows=619 width=33) (actual rows=619 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 48kB
                    ->  Seq Scan on stall_day_overrides o  (cost=0.00..14.19 rows=619 width=33) (actual rows=619 loops=1)
        ->  Hash  (cost=2020.06..2020.06 rows=3240 width=34) (actual rows=25968 loops=1)
              Buckets: 32768 (originally 4096)  Batches: 1 (originally 1)  Memory Usage: 1930kB
              ->  Subquery Scan on bk  (cost=1955.26..2020.06 rows=3240 width=34) (actual rows=25968 loops=1)
                    ->  HashAggregate  (cost=1955.26..1987.66 rows=3240 width=34) (actual rows=25968 loops=1)
                          Group Key: b.market_day_id, b.stall_id
                          Batches: 1  Memory Usage: 3857kB
                          ->  Hash Join  (cost=3.38..1533.41 rows=25960 width=36) (actual rows=25968 loops=1)
                                Hash Cond: (b.market_day_id = d_2.id)
                                ->  Seq Scan on bookings b  (cost=0.00..1173.08 rows=25960 width=36) (actual rows=25968 loops=1)
                                      Filter: (status = ANY ('{HOLD,PENDING_PAYMENT,PENDING_VERIFY,CONFIRMED}'::"BookingStatus"[]))
                                      Rows Removed by Filter: 6437
                                ->  Hash  (cost=2.08..2.08 rows=104 width=16) (actual rows=104 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 13kB
                                      ->  CTE Scan on d d_2  (cost=0.00..2.08 rows=104 width=16) (actual rows=104 loops=1)
Planning Time: 0.939 ms
Execution Time: 17.599 ms
```

### occupancy by zone

```
HashAggregate  (cost=2965.17..2965.26 rows=4 width=44) (actual rows=4 loops=1)
  Group Key: (s.zone_id)::text
  Batches: 1  Memory Usage: 24kB
  CTE d
    ->  Seq Scan on market_days md  (cost=0.00..3.82 rows=104 width=20) (actual rows=104 loops=1)
          Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
  ->  Hash Left Join  (cost=2095.51..2808.47 rows=15288 width=34) (actual rows=29968 loops=1)
        Hash Cond: ((d_1.id = bk.day_id) AND (s.id = bk.stall_id))
        ->  Hash Left Join  (cost=26.86..583.11 rows=15288 width=48) (actual rows=29968 loops=1)
              Hash Cond: ((s.id = o.stall_id) AND (d_1.id = o.market_day_id))
              Filter: (NOT COALESCE(o.is_closed, false))
              Rows Removed by Filter: 608
              ->  Nested Loop  (cost=3.38..399.10 rows=30576 width=48) (actual rows=30576 loops=1)
                    ->  Seq Scan on stalls s  (cost=0.00..9.75 rows=294 width=32) (actual rows=294 loops=1)
                          Filter: (is_active AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
                          Rows Removed by Filter: 6
                    ->  Materialize  (cost=3.38..7.41 rows=104 width=16) (actual rows=104 loops=294)
                          ->  Hash Join  (cost=3.38..6.89 rows=104 width=16) (actual rows=104 loops=1)
                                Hash Cond: (d_1.id = d.id)
                                ->  CTE Scan on d d_1  (cost=0.00..2.08 rows=104 width=16) (actual rows=104 loops=1)
                                ->  Hash  (cost=2.08..2.08 rows=104 width=16) (actual rows=104 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 13kB
                                      ->  CTE Scan on d  (cost=0.00..2.08 rows=104 width=16) (actual rows=104 loops=1)
              ->  Hash  (cost=14.19..14.19 rows=619 width=33) (actual rows=619 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 48kB
                    ->  Seq Scan on stall_day_overrides o  (cost=0.00..14.19 rows=619 width=33) (actual rows=619 loops=1)
        ->  Hash  (cost=2020.06..2020.06 rows=3240 width=34) (actual rows=25968 loops=1)
              Buckets: 32768 (originally 4096)  Batches: 1 (originally 1)  Memory Usage: 1930kB
              ->  Subquery Scan on bk  (cost=1955.26..2020.06 rows=3240 width=34) (actual rows=25968 loops=1)
                    ->  HashAggregate  (cost=1955.26..1987.66 rows=3240 width=34) (actual rows=25968 loops=1)
                          Group Key: b.market_day_id, b.stall_id
                          Batches: 1  Memory Usage: 3857kB
                          ->  Hash Join  (cost=3.38..1533.41 rows=25960 width=36) (actual rows=25968 loops=1)
                                Hash Cond: (b.market_day_id = d_2.id)
                                ->  Seq Scan on bookings b  (cost=0.00..1173.08 rows=25960 width=36) (actual rows=25968 loops=1)
                                      Filter: (status = ANY ('{HOLD,PENDING_PAYMENT,PENDING_VERIFY,CONFIRMED}'::"BookingStatus"[]))
                                      Rows Removed by Filter: 6437
                                ->  Hash  (cost=2.08..2.08 rows=104 width=16) (actual rows=104 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 13kB
                                      ->  CTE Scan on d d_2  (cost=0.00..2.08 rows=104 width=16) (actual rows=104 loops=1)
Planning Time: 0.386 ms
Execution Time: 17.469 ms
```

```
Seq Scan on zones  (cost=0.00..1.06 rows=4 width=32) (actual rows=4 loops=1)
  Filter: (id = ANY ('{ce398d97-be03-4eb0-ba9a-0b65887c992d,4b5ea35c-059b-4736-ba4d-5614b9f17500,41cda0a7-9723-4d2e-ba8f-6d808903f844,ef5a3f84-d89c-4b1a-a289-736bff70cfc3}'::uuid[]))
Planning Time: 0.055 ms
Execution Time: 0.015 ms
```

### vendors top (bookings)

```
Limit  (cost=4194.84..4194.97 rows=50 width=525) (actual rows=50 loops=1)
  ->  Sort  (cost=4194.84..4198.57 rows=1493 width=525) (actual rows=50 loops=1)
        Sort Key: ((COALESCE(b.bookings, '0'::bigint))::integer) DESC, (COALESCE(r.revenue, '0'::numeric)) DESC, v.id
        Sort Method: quicksort  Memory: 33kB
        ->  Nested Loop Left Join  (cost=4064.66..4145.24 rows=1493 width=525) (actual rows=67 loops=1)
              Join Filter: (r.vendor_id = v.id)
              Rows Removed by Join Filter: 66
              ->  Hash Left Join  (cost=1590.81..1641.51 rows=1493 width=501) (actual rows=67 loops=1)
                    Hash Cond: (v.id = b.vendor_id)
                    Filter: ((b.vendor_id IS NOT NULL) OR (v.noshow_count > 0))
                    Rows Removed by Filter: 1433
                    ->  Seq Scan on vendors v  (cost=0.00..46.75 rows=1500 width=485) (actual rows=1500 loops=1)
                          Filter: (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid)
                    ->  Hash  (cost=1590.80..1590.80 rows=1 width=32) (actual rows=1 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                          ->  Subquery Scan on b  (cost=1590.78..1590.80 rows=1 width=32) (actual rows=1 loops=1)
                                ->  HashAggregate  (cost=1590.78..1590.79 rows=1 width=32) (actual rows=1 loops=1)
                                      Group Key: b_1.vendor_id
                                      Batches: 1  Memory Usage: 24kB
                                      ->  Hash Join  (cost=5.12..1104.70 rows=32405 width=28) (actual rows=32405 loops=1)
                                            Hash Cond: (b_1.market_day_id = md.id)
                                            ->  Seq Scan on bookings b_1  (cost=0.00..1011.05 rows=32405 width=44) (actual rows=32405 loops=1)
                                            ->  Hash  (cost=3.82..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 13kB
                                                  ->  Seq Scan on market_days md  (cost=0.00..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                                        Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
              ->  Materialize  (cost=2473.85..2473.87 rows=1 width=48) (actual rows=1 loops=67)
                    ->  Subquery Scan on r  (cost=2473.85..2473.87 rows=1 width=48) (actual rows=1 loops=1)
                          ->  HashAggregate  (cost=2473.85..2473.86 rows=1 width=48) (actual rows=1 loops=1)
                                Group Key: b_2.vendor_id
                                Batches: 1  Memory Usage: 24kB
                                ->  Hash Join  (cost=1421.23..2344.01 rows=25968 width=21) (actual rows=25968 loops=1)
                                      Hash Cond: (b_2.market_day_id = md_1.id)
                                      ->  Hash Join  (cost=1416.11..2267.94 rows=25968 width=37) (actual rows=25968 loops=1)
                                            Hash Cond: (p.booking_id = b_2.id)
                                            ->  Seq Scan on payments p  (cost=0.00..783.65 rows=25968 width=21) (actual rows=25968 loops=1)
                                                  Filter: (status = 'APPROVED'::"PaymentStatus")
                                                  Rows Removed by Filter: 2564
                                            ->  Hash  (cost=1011.05..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                                                  Buckets: 32768  Batches: 1  Memory Usage: 2788kB
                                                  ->  Seq Scan on bookings b_2  (cost=0.00..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                                      ->  Hash  (cost=3.82..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 13kB
                                            ->  Seq Scan on market_days md_1  (cost=0.00..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                                  Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
Planning Time: 0.850 ms
Execution Time: 15.324 ms
```

### vendors top (noshow, 500)

```
Limit  (cost=4219.64..4220.89 rows=500 width=525) (actual rows=67 loops=1)
  ->  Sort  (cost=4219.64..4223.37 rows=1493 width=525) (actual rows=67 loops=1)
        Sort Key: v.noshow_count DESC, ((COALESCE(b.bookings, '0'::bigint))::integer) DESC, v.id
        Sort Method: quicksort  Memory: 33kB
        ->  Nested Loop Left Join  (cost=4064.66..4145.24 rows=1493 width=525) (actual rows=67 loops=1)
              Join Filter: (r.vendor_id = v.id)
              Rows Removed by Join Filter: 66
              ->  Hash Left Join  (cost=1590.81..1641.51 rows=1493 width=501) (actual rows=67 loops=1)
                    Hash Cond: (v.id = b.vendor_id)
                    Filter: ((b.vendor_id IS NOT NULL) OR (v.noshow_count > 0))
                    Rows Removed by Filter: 1433
                    ->  Seq Scan on vendors v  (cost=0.00..46.75 rows=1500 width=485) (actual rows=1500 loops=1)
                          Filter: (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid)
                    ->  Hash  (cost=1590.80..1590.80 rows=1 width=32) (actual rows=1 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                          ->  Subquery Scan on b  (cost=1590.78..1590.80 rows=1 width=32) (actual rows=1 loops=1)
                                ->  HashAggregate  (cost=1590.78..1590.79 rows=1 width=32) (actual rows=1 loops=1)
                                      Group Key: b_1.vendor_id
                                      Batches: 1  Memory Usage: 24kB
                                      ->  Hash Join  (cost=5.12..1104.70 rows=32405 width=28) (actual rows=32405 loops=1)
                                            Hash Cond: (b_1.market_day_id = md.id)
                                            ->  Seq Scan on bookings b_1  (cost=0.00..1011.05 rows=32405 width=44) (actual rows=32405 loops=1)
                                            ->  Hash  (cost=3.82..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 13kB
                                                  ->  Seq Scan on market_days md  (cost=0.00..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                                        Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
              ->  Materialize  (cost=2473.85..2473.87 rows=1 width=48) (actual rows=1 loops=67)
                    ->  Subquery Scan on r  (cost=2473.85..2473.87 rows=1 width=48) (actual rows=1 loops=1)
                          ->  HashAggregate  (cost=2473.85..2473.86 rows=1 width=48) (actual rows=1 loops=1)
                                Group Key: b_2.vendor_id
                                Batches: 1  Memory Usage: 24kB
                                ->  Hash Join  (cost=1421.23..2344.01 rows=25968 width=21) (actual rows=25968 loops=1)
                                      Hash Cond: (b_2.market_day_id = md_1.id)
                                      ->  Hash Join  (cost=1416.11..2267.94 rows=25968 width=37) (actual rows=25968 loops=1)
                                            Hash Cond: (p.booking_id = b_2.id)
                                            ->  Seq Scan on payments p  (cost=0.00..783.65 rows=25968 width=21) (actual rows=25968 loops=1)
                                                  Filter: (status = 'APPROVED'::"PaymentStatus")
                                                  Rows Removed by Filter: 2564
                                            ->  Hash  (cost=1011.05..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                                                  Buckets: 32768  Batches: 1  Memory Usage: 2788kB
                                                  ->  Seq Scan on bookings b_2  (cost=0.00..1011.05 rows=32405 width=48) (actual rows=32405 loops=1)
                                      ->  Hash  (cost=3.82..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 13kB
                                            ->  Seq Scan on market_days md_1  (cost=0.00..3.82 rows=104 width=16) (actual rows=104 loops=1)
                                                  Filter: ((NOT is_cancelled) AND (market_date >= '2025-11-08'::date) AND (market_date <= '2026-11-01'::date) AND (market_id = '01a19609-c1c2-758f-8745-4045776be682'::uuid))
Planning Time: 0.488 ms
Execution Time: 15.093 ms
```

### audit log: หน้าแรก (ไม่กรอง)

```
Limit  (cost=0.53..3.36 rows=20 width=758) (actual rows=20 loops=1)
  ->  Incremental Sort  (cost=0.53..27586.92 rows=194442 width=758) (actual rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Presorted Key: created_at
        Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
        ->  Index Scan Backward using audit_logs_created_at_idx on audit_logs  (cost=0.42..18837.03 rows=194442 width=758) (actual rows=21 loops=1)
Planning Time: 0.033 ms
Execution Time: 0.038 ms
```

```
Aggregate  (cost=7727.94..7727.95 rows=1 width=8) (actual rows=1 loops=1)
  ->  Seq Scan on audit_logs  (cost=0.00..5297.42 rows=194442 width=16) (actual rows=194442 loops=1)
Planning Time: 0.026 ms
Execution Time: 6.788 ms
```

```
Index Scan using vendors_pkey on vendors  (cost=0.28..8.29 rows=1 width=48) (actual rows=1 loops=1)
  Index Cond: (id = '248488c1-5766-484e-829a-f322a0b7382e'::uuid)
Planning Time: 0.026 ms
Execution Time: 0.020 ms
```

### audit log: action + ช่วง 1 เดือน

```
Limit  (cost=12.04..243.13 rows=20 width=758) (actual rows=20 loops=1)
  ->  Incremental Sort  (cost=12.04..1329.26 rows=114 width=758) (actual rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Presorted Key: created_at
        Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 27kB  Peak Memory: 27kB
        ->  Index Scan Backward using audit_logs_created_at_idx on audit_logs  (cost=0.42..1324.13 rows=114 width=758) (actual rows=21 loops=1)
              Index Cond: ((created_at >= '2026-10-31 17:00:00+00'::timestamp with time zone) AND (created_at < '2026-11-01 17:00:00+00'::timestamp with time zone))
              Filter: ((action)::text ~~ 'payment.%'::text)
              Rows Removed by Filter: 39
Planning Time: 0.108 ms
Execution Time: 0.074 ms
```

```
Aggregate  (cost=1020.95..1020.96 rows=1 width=8) (actual rows=1 loops=1)
  ->  Bitmap Heap Scan on audit_logs  (cost=11.88..1019.53 rows=114 width=16) (actual rows=107 loops=1)
        Recheck Cond: ((created_at >= '2026-10-31 17:00:00+00'::timestamp with time zone) AND (created_at < '2026-11-01 17:00:00+00'::timestamp with time zone))
        Filter: ((action)::text ~~ 'payment.%'::text)
        Rows Removed by Filter: 231
        Heap Blocks: exact=322
        ->  Bitmap Index Scan on audit_logs_created_at_idx  (cost=0.00..11.85 rows=343 width=0) (actual rows=338 loops=1)
              Index Cond: ((created_at >= '2026-10-31 17:00:00+00'::timestamp with time zone) AND (created_at < '2026-11-01 17:00:00+00'::timestamp with time zone))
Planning Time: 0.129 ms
Execution Time: 0.358 ms
```

```
Seq Scan on admin_users  (cost=0.00..1.01 rows=1 width=28) (actual rows=1 loops=1)
  Filter: (id = '01a19609-c1c8-7185-a56f-b11374eb6797'::uuid)
Planning Time: 0.020 ms
Execution Time: 0.009 ms
```

### audit log: action หายาก ทั้งปี

```
Limit  (cost=27.92..27.93 rows=6 width=758) (actual rows=12 loops=1)
  ->  Sort  (cost=27.92..27.93 rows=6 width=758) (actual rows=12 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: quicksort  Memory: 26kB
        ->  Bitmap Heap Scan on audit_logs  (cost=4.50..27.84 rows=6 width=758) (actual rows=12 loops=1)
              Recheck Cond: (((action)::text = 'settings.update'::text) AND (created_at >= '2025-11-07 17:00:00+00'::timestamp with time zone) AND (created_at < '2026-11-01 17:00:00+00'::timestamp with time zone))
              Heap Blocks: exact=1
              ->  Bitmap Index Scan on audit_logs_action_created_at_idx  (cost=0.00..4.50 rows=6 width=0) (actual rows=12 loops=1)
                    Index Cond: (((action)::text = 'settings.update'::text) AND (created_at >= '2025-11-07 17:00:00+00'::timestamp with time zone) AND (created_at < '2026-11-01 17:00:00+00'::timestamp with time zone))
Planning Time: 0.084 ms
Execution Time: 0.040 ms
```

```
Aggregate  (cost=27.92..27.93 rows=1 width=8) (actual rows=1 loops=1)
  ->  Bitmap Heap Scan on audit_logs  (cost=4.50..27.84 rows=6 width=16) (actual rows=12 loops=1)
        Recheck Cond: (((action)::text = 'settings.update'::text) AND (created_at >= '2025-11-07 17:00:00+00'::timestamp with time zone) AND (created_at < '2026-11-01 17:00:00+00'::timestamp with time zone))
        Heap Blocks: exact=1
        ->  Bitmap Index Scan on audit_logs_action_created_at_idx  (cost=0.00..4.50 rows=6 width=0) (actual rows=12 loops=1)
              Index Cond: (((action)::text = 'settings.update'::text) AND (created_at >= '2025-11-07 17:00:00+00'::timestamp with time zone) AND (created_at < '2026-11-01 17:00:00+00'::timestamp with time zone))
Planning Time: 0.072 ms
Execution Time: 0.029 ms
```

```
Seq Scan on admin_users  (cost=0.00..1.01 rows=1 width=28) (actual rows=1 loops=1)
  Filter: (id = '01a19609-c1c8-7185-a56f-b11374eb6797'::uuid)
Planning Time: 0.018 ms
Execution Time: 0.008 ms
```

### audit log: หน้าลึก (page 500)

```
Limit  (cost=3540.30..3547.39 rows=50 width=758) (actual rows=50 loops=1)
  ->  Incremental Sort  (cost=0.53..27586.92 rows=194442 width=758) (actual rows=25000 loops=1)
        Sort Key: created_at DESC, id DESC
        Presorted Key: created_at
        Full-sort Groups: 782  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
        ->  Index Scan Backward using audit_logs_created_at_idx on audit_logs  (cost=0.42..18837.03 rows=194442 width=758) (actual rows=25001 loops=1)
Planning Time: 0.036 ms
Execution Time: 6.012 ms
```

```
Aggregate  (cost=7727.94..7727.95 rows=1 width=8) (actual rows=1 loops=1)
  ->  Seq Scan on audit_logs  (cost=0.00..5297.42 rows=194442 width=16) (actual rows=194442 loops=1)
Planning Time: 0.035 ms
Execution Time: 5.889 ms
```

```
Seq Scan on admin_users  (cost=0.00..1.01 rows=1 width=28) (actual rows=1 loops=1)
  Filter: (id = '01a19609-c1c8-7185-a56f-b11374eb6797'::uuid)
Planning Time: 0.027 ms
Execution Time: 0.008 ms
```

### audit log: รายการ action

```
Unique  (cost=5367.46..5367.53 rows=7 width=14) (actual rows=7 loops=1)
  ->  Sort  (cost=5367.46..5367.49 rows=14 width=14) (actual rows=19 loops=1)
        Sort Key: action
        Sort Method: quicksort  Memory: 25kB
        ->  Gather  (cost=5365.72..5367.19 rows=14 width=14) (actual rows=19 loops=1)
              Workers Planned: 2
              Workers Launched: 2
              ->  HashAggregate  (cost=4365.72..4365.79 rows=7 width=14) (actual rows=6 loops=3)
                    Group Key: action
                    Batches: 1  Memory Usage: 24kB
                    Worker 0:  Batches: 1  Memory Usage: 24kB
                    Worker 1:  Batches: 1  Memory Usage: 24kB
                    ->  Parallel Seq Scan on audit_logs  (cost=0.00..4163.18 rows=81018 width=14) (actual rows=64814 loops=3)
Planning Time: 0.069 ms
Execution Time: 10.942 ms
```

