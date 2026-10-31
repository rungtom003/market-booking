import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { thaiMobilePhoneSchema, vendorRegisterSchema } from '@market-booking/shared';
import type { UploadRequestInput } from '@market-booking/shared';
import { z } from 'zod';
import { vendorApi } from '../api/vendor';
import { ImageUpload } from '../components/ImageUpload';
import { Layout } from '../components/Layout';
import { Alert, Button, Card, Select, Spinner, TextArea, TextField } from '../components/ui';
import { applyFieldErrors, errorCode, errorMessage } from '../lib/errors';
import { formatPhone } from '../lib/format';
import { registrationDraft } from '../lib/registration-draft';
import { session } from '../lib/session';

// schema เดียวกับ API ยกเว้น: เบอร์บังคับเสมอ (ทาง OTP ใส่เบอร์ที่ยืนยันแล้วไว้ให้ — server ใช้เบอร์จาก token อยู่ดี)
// และ checkbox PDPA เป็น boolean (ค่าเริ่มต้น false) แล้วบังคับว่าต้องติ๊ก
const formSchema = vendorRegisterSchema.omit({ registrationToken: true }).extend({
  phone: thaiMobilePhoneSchema,
  pdpaConsent: z.boolean().refine((v) => v, 'กรุณายอมรับนโยบายความเป็นส่วนตัว'),
  // <select> ที่ยังไม่เลือกให้ค่า '' — ส่งเป็น null ตอน submit
  productCategoryId: z.union([z.literal(''), z.uuid()]).nullish(),
});

type FormValues = z.input<typeof formSchema>;
const FIELDS = [
  'phone',
  'firstName',
  'lastName',
  'address',
  'shopName',
  'productCategoryId',
  'idCardImageKey',
  'shopImageKey',
  'pdpaConsent',
] as const;

export function RegisterPage() {
  const draft = registrationDraft.load();
  if (!draft) return <Navigate to="/login" replace />;
  return <RegisterForm draft={draft} />;
}

function RegisterForm({
  draft,
}: {
  draft: NonNullable<ReturnType<typeof registrationDraft.load>>;
}) {
  const navigate = useNavigate();
  const verifiedPhone = draft.prefill.phone;
  const token = draft.registrationToken;
  const [formError, setFormError] = useState<{ message: string; code: string } | null>(null);
  const [uploading, setUploading] = useState(0);

  const options = useQuery({
    queryKey: ['register-options', token],
    queryFn: () => vendorApi.registrationOptions(token),
    retry: false,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      phone: verifiedPhone ?? '',
      firstName: draft.prefill.displayName ?? '',
      pdpaConsent: false,
    },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    // บังคับรูปตามการตั้งค่าของตลาด (ตรวจก่อนส่ง ไม่ต้องรอ server)
    const required = options.data;
    let missing = false;
    if (required?.requireIdCardImage && !values.idCardImageKey) {
      form.setError('idCardImageKey', { message: 'กรุณาแนบรูปบัตรประชาชน' });
      missing = true;
    }
    if (required?.requireShopImage && !values.shopImageKey) {
      form.setError('shopImageKey', { message: 'กรุณาแนบรูปร้าน/สินค้า' });
      missing = true;
    }
    if (missing) return;

    try {
      const result = await vendorApi.register({
        ...values,
        shopName: values.shopName || null,
        productCategoryId: values.productCategoryId || null,
        pdpaConsent: true,
        registrationToken: token,
      });
      registrationDraft.clear();
      session.signIn(result.accessToken);
      navigate('/', { replace: true });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, FIELDS)) {
        setFormError({ message: errorMessage(e), code: errorCode(e) });
      }
    }
  });

  const requestUpload = (input: UploadRequestInput) => vendorApi.registrationUpload(token, input);
  const trackUpload = (busy: boolean) => setUploading((n) => n + (busy ? 1 : -1));

  if (options.isPending)
    return (
      <Layout title="สมัครสมาชิก">
        <Spinner label="กำลังโหลด…" />
      </Layout>
    );
  if (options.isError) return <ExpiredDraft />;

  return (
    <Layout title="สมัครสมาชิก">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Card className="flex flex-col gap-4">
          {verifiedPhone ? (
            <div className="text-sm">
              <span className="text-gray-600">เบอร์มือถือ (ยืนยันแล้ว)</span>
              <p className="text-base font-semibold text-gray-900">{formatPhone(verifiedPhone)}</p>
            </div>
          ) : (
            <>
              <Alert tone="info">
                เคยสมัครด้วยเบอร์โทรแล้ว?{' '}
                <Link to="/login?link=line" className="font-semibold underline">
                  ยืนยันเบอร์เพื่อเชื่อม LINE เข้ากับบัญชีเดิม
                </Link>
              </Alert>
              <TextField
                label="เบอร์มือถือ"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                required
                error={errors.phone?.message}
                {...form.register('phone')}
              />
            </>
          )}
          <TextField
            label="ชื่อ"
            autoComplete="given-name"
            required
            error={errors.firstName?.message}
            {...form.register('firstName')}
          />
          <TextField
            label="นามสกุล"
            autoComplete="family-name"
            required
            error={errors.lastName?.message}
            {...form.register('lastName')}
          />
          <TextArea
            label="ที่อยู่"
            autoComplete="street-address"
            required
            error={errors.address?.message}
            {...form.register('address')}
          />
        </Card>

        <Card className="flex flex-col gap-4">
          <TextField
            label="ชื่อร้าน"
            error={errors.shopName?.message}
            {...form.register('shopName')}
          />
          <Select
            label="ประเภทสินค้า"
            error={errors.productCategoryId?.message}
            {...form.register('productCategoryId')}
          >
            <option value="">— เลือกประเภทสินค้า —</option>
            {options.data.productCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <ImageUpload
            label="รูปบัตรประชาชน"
            kind="ID_CARD"
            required={options.data.requireIdCardImage}
            error={errors.idCardImageKey?.message}
            requestUpload={requestUpload}
            onBusyChange={trackUpload}
            onUploaded={(key) => form.setValue('idCardImageKey', key, { shouldValidate: true })}
          />
          <ImageUpload
            label="รูปร้าน/สินค้า"
            kind="SHOP"
            required={options.data.requireShopImage}
            error={errors.shopImageKey?.message}
            requestUpload={requestUpload}
            onBusyChange={trackUpload}
            onUploaded={(key) => form.setValue('shopImageKey', key, { shouldValidate: true })}
          />
        </Card>

        <Card>
          <label className="flex items-start gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-green-700"
              {...form.register('pdpaConsent')}
            />
            <span>
              ฉันยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลตาม{' '}
              <Link
                to="/privacy"
                target="_blank"
                className="font-semibold text-green-800 underline"
              >
                นโยบายความเป็นส่วนตัว
              </Link>
            </span>
          </label>
          {errors.pdpaConsent && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {errors.pdpaConsent.message}
            </p>
          )}
        </Card>

        {formError && (
          <Alert>
            {formError.message}
            {formError.code === 'PHONE_ALREADY_REGISTERED' && (
              <Link to="/login?link=line" className="mt-2 block font-semibold underline">
                ไปหน้าเข้าสู่ระบบ
              </Link>
            )}
            {formError.code === 'UNAUTHORIZED' && <ExpiredLink />}
          </Alert>
        )}
        <Button type="submit" loading={form.formState.isSubmitting} disabled={uploading > 0}>
          {uploading > 0 ? 'รออัปโหลดรูป…' : 'สมัครสมาชิก'}
        </Button>
      </form>
    </Layout>
  );
}

function ExpiredDraft() {
  return (
    <Layout title="สมัครสมาชิก">
      <Alert title="หมดเวลาการสมัคร">
        กรุณายืนยันเบอร์โทรอีกครั้ง <ExpiredLink />
      </Alert>
    </Layout>
  );
}

function ExpiredLink() {
  return (
    <Link
      to="/login"
      onClick={() => registrationDraft.clear()}
      className="mt-2 block font-semibold underline"
    >
      ไปหน้ายืนยันเบอร์
    </Link>
  );
}
