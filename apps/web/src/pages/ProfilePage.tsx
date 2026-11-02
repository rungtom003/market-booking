import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { vendorRegisterSchema } from '@market-booking/shared';
import type {
  UpdateVendorProfileInput,
  VendorFormOptions,
  VendorProfile,
} from '@market-booking/shared';
import { z } from 'zod';
import { useMyProfile, useProfileOptions, useUpdateProfile, vendorApi } from '../api/vendor';
import { ImageUpload } from '../components/ImageUpload';
import { Layout } from '../components/Layout';
import { PrivacyActions } from '../components/PrivacyActions';
import { Alert, Button, Card, Select, Spinner, TextArea, TextField } from '../components/ui';
import { applyFieldErrors, errorMessage } from '../lib/errors';
import { formatPhone } from '../lib/format';

const formSchema = vendorRegisterSchema
  .pick({
    firstName: true,
    lastName: true,
    address: true,
    shopName: true,
    productCategoryId: true,
    idCardImageKey: true,
    shopImageKey: true,
  })
  .extend({
    // <select> ที่ยังไม่เลือกให้ค่า '' — ส่งเป็น null ตอน submit
    productCategoryId: z.union([z.literal(''), z.uuid()]).nullish(),
  });
type FormValues = z.input<typeof formSchema>;
const FIELDS = Object.keys(formSchema.shape);

export function ProfilePage() {
  const profile = useMyProfile();
  const options = useProfileOptions();

  return (
    <Layout title="ข้อมูลของฉัน">
      {profile.isPending || options.isPending ? (
        <Spinner label="กำลังโหลด…" />
      ) : profile.isError || options.isError ? (
        <Alert>{errorMessage(profile.error ?? options.error)}</Alert>
      ) : (
        <>
          <ProfileForm profile={profile.data} options={options.data} />
          <PrivacyActions />
        </>
      )}
    </Layout>
  );
}

function ProfileForm({ profile, options }: { profile: VendorProfile; options: VendorFormOptions }) {
  const update = useUpdateProfile();
  const [result, setResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const wasRejected = profile.status === 'REJECTED';

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: profile.firstName,
      lastName: profile.lastName,
      address: profile.address,
      shopName: profile.shopName ?? '',
      productCategoryId: profile.productCategory?.id ?? '',
    },
  });
  const { errors, dirtyFields } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setResult(null);
    // ส่งเฉพาะช่องที่แก้ (ช่องว่าง = ล้างค่า)
    const changed = Object.fromEntries(
      Object.entries(values)
        .filter(([key]) => dirtyFields[key as keyof FormValues])
        .map(([key, value]) => [key, value === '' ? null : value]),
    ) as UpdateVendorProfileInput;
    if (Object.keys(changed).length === 0 && !wasRejected) {
      setResult({ tone: 'success', message: 'ไม่มีข้อมูลที่เปลี่ยนแปลง' });
      return;
    }
    try {
      // ถูกปฏิเสธแต่ไม่ได้แก้อะไร → ส่งชื่อเดิมไปเพื่อส่งตรวจใหม่
      const updated = await update.mutateAsync(
        Object.keys(changed).length > 0 ? changed : { firstName: values.firstName },
      );
      form.reset({ ...values });
      setResult({
        tone: 'success',
        message:
          wasRejected && updated.status === 'PENDING'
            ? 'ส่งข้อมูลให้เจ้าหน้าที่ตรวจสอบใหม่แล้ว'
            : 'บันทึกข้อมูลแล้ว',
      });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, FIELDS)) {
        setResult({ tone: 'error', message: errorMessage(e) });
      }
    }
  });

  const trackUpload = (busy: boolean) => setUploading((n) => n + (busy ? 1 : -1));
  const setImage = (field: 'idCardImageKey' | 'shopImageKey') => (key: string) =>
    form.setValue(field, key, { shouldDirty: true, shouldValidate: true });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {wasRejected && (
        <Alert title="ไม่ผ่านการอนุมัติ">
          {profile.rejectReason && <p>เหตุผล: {profile.rejectReason}</p>}
          <p>แก้ไขข้อมูลแล้วกด "บันทึกและส่งตรวจใหม่"</p>
        </Alert>
      )}
      <Card className="flex flex-col gap-4">
        <div className="text-sm">
          <span className="text-gray-600">เบอร์มือถือ</span>
          <p className="text-base font-semibold text-gray-900">{formatPhone(profile.phone)}</p>
        </div>
        <TextField
          label="ชื่อ"
          required
          error={errors.firstName?.message}
          {...form.register('firstName')}
        />
        <TextField
          label="นามสกุล"
          required
          error={errors.lastName?.message}
          {...form.register('lastName')}
        />
        <TextArea
          label="ที่อยู่"
          required
          error={errors.address?.message}
          {...form.register('address')}
        />
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
          {options.productCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <ImageUpload
          label="รูปบัตรประชาชน"
          required={options.requireIdCardImage}
          currentUrl={profile.idCardImageUrl}
          error={errors.idCardImageKey?.message}
          requestUpload={(file) => vendorApi.profileUpload({ ...file, kind: 'ID_CARD' })}
          onBusyChange={trackUpload}
          onUploaded={setImage('idCardImageKey')}
        />
        <ImageUpload
          label="รูปร้าน/สินค้า"
          required={options.requireShopImage}
          currentUrl={profile.shopImageUrl}
          error={errors.shopImageKey?.message}
          requestUpload={(file) => vendorApi.profileUpload({ ...file, kind: 'SHOP' })}
          onBusyChange={trackUpload}
          onUploaded={setImage('shopImageKey')}
        />
      </Card>
      {result && <Alert tone={result.tone}>{result.message}</Alert>}
      <Button type="submit" loading={form.formState.isSubmitting} disabled={uploading > 0}>
        {uploading > 0 ? 'รออัปโหลดรูป…' : wasRejected ? 'บันทึกและส่งตรวจใหม่' : 'บันทึก'}
      </Button>
      <Link to="/" className="text-center text-sm text-green-800 underline">
        กลับหน้าหลัก
      </Link>
    </form>
  );
}
